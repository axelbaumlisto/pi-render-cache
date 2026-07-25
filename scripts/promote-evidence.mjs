#!/usr/bin/env node
/** Promote a sanitized, compact benchmark summary; raw evidence stays external. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapMedianCI, median, readJSON, sha256File } from "./benchmark-lib.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(PROJECT_ROOT, "fixtures", "stream-replay.json");
const args = process.argv.slice(2);

function requiredOption(name) {
	const index = args.indexOf(`--${name}`);
	if (index === -1 || index + 1 >= args.length || args[index + 1].startsWith("--")) {
		throw new Error(`--${name} is required`);
	}
	return args[index + 1];
}
function redactHome(value) {
	if (typeof value !== "string") return value;
	const home = os.homedir();
	return home ? value.split(home).join("<redacted>") : value;
}
function sameUnit(run, results) {
	return (
		run?.pi?.version === results.pi?.version &&
		run?.pi?.root === results.pi?.root &&
		run?.piTui?.version === results.piTui?.version &&
		run?.piTui?.root === results.piTui?.root &&
		run?.piTui?.entry === results.piTui?.entry &&
		run?.theme?.path === results.theme?.path
	);
}
function meanWall(run) {
	return run.samples.reduce((sum, sample) => sum + sample.wallMs, 0) / run.samples.length;
}

try {
	const inputArg = requiredOption("input");
	const release = requiredOption("release");
	if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release)) {
		throw new Error(`invalid --release ${release}; expected vX.Y.Z with an optional prerelease suffix`);
	}
	const input = path.resolve(PROJECT_ROOT, inputArg);
	const results = readJSON(input);
	if (results?.schema !== "pi-render-cache/benchmark-results/v1") throw new Error("unsupported benchmark schema");
	if (!Array.isArray(results.blocks) || results.blocks.length === 0) throw new Error("benchmark contains no blocks");
	if (!Array.isArray(results.config?.workloads) || !Array.isArray(results.config?.modes)) {
		throw new Error("benchmark configuration is incomplete");
	}

	const fixtureHash = sha256File(FIXTURE);
	if (results.corpus?.sha256 !== fixtureHash) {
		throw new Error(`corpus hash mismatch: input ${results.corpus?.sha256 ?? "missing"}, fixture ${fixtureHash}`);
	}
	const allRuns = results.blocks.flatMap((block) => block.runs ?? []);
	if (allRuns.length === 0 || allRuns.some((run) => run.byteIdentical !== true)) {
		throw new Error("not every archived run is byte-identical");
	}
	if (allRuns.some((run) => !sameUnit(run, results))) {
		throw new Error("worker environment/realpaths differ from the benchmark header");
	}

	const workloads = {};
	for (const workload of results.config.workloads) {
		const blocks = results.blocks.filter((block) => block.workload === workload);
		const expectedModes = results.config.modes;
		if (
			blocks.length === 0 ||
			blocks.some(
				(block) =>
					!Array.isArray(block.runs) ||
					expectedModes.some((mode) => block.runs.filter((run) => run.mode === mode).length !== 1),
			)
		) {
			throw new Error(`incomplete mode set for workload ${workload}`);
		}
		const runs = blocks.flatMap((block) => block.runs);
		const outputHashes = [...new Set(runs.map((run) => run.outputSha256))];
		const replayHashes = [...new Set(runs.map((run) => JSON.stringify(run.replayOutputHashes)))];
		if (outputHashes.length !== 1 || typeof outputHashes[0] !== "string" || replayHashes.length !== 1) {
			throw new Error(`result hashes disagree across modes/blocks for workload ${workload}`);
		}

		const ratios = {};
		for (const mode of expectedModes.filter((candidate) => candidate !== "baseline")) {
			const values = blocks.map((block) => {
				const baseline = block.runs.find((run) => run.mode === "baseline");
				const patched = block.runs.find((run) => run.mode === mode);
				return Math.log(meanWall(baseline) / meanWall(patched));
			});
			if (values.some((value) => !Number.isFinite(value))) throw new Error(`invalid timing samples for ${workload}/${mode}`);
			const ci = bootstrapMedianCI(values, { resamples: 10_000, seed: 12345 });
			ratios[mode] = {
				blocks: values.length,
				medianSpeedup: Math.exp(ci.median),
				ci95Speedup: [Math.exp(ci.ci95[0]), Math.exp(ci.ci95[1])],
			};
		}

		const memory = {};
		for (const mode of expectedModes) {
			const replayPeak = blocks.map(
				(block) => block.runs.find((run) => run.mode === mode)?.memory?.replayPeakDeltaBytes,
			);
			const retainedEnd = blocks.map(
				(block) => block.runs.find((run) => run.mode === mode)?.memory?.retainedEndDeltaBytes,
			);
			if ([...replayPeak, ...retainedEnd].some((value) => !Number.isFinite(value))) {
				throw new Error(`invalid memory samples for ${workload}/${mode}`);
			}
			memory[mode] = {
				medianReplayPeakDeltaBytes: median(replayPeak),
				medianRetainedEndDeltaBytes: median(retainedEnd),
			};
			if (mode !== "baseline") {
				const pairedPeak = blocks.map((block) => {
					const baseline = block.runs.find((run) => run.mode === "baseline").memory.replayPeakDeltaBytes;
					const patched = block.runs.find((run) => run.mode === mode).memory.replayPeakDeltaBytes;
					return patched - baseline;
				});
				const pairedRetained = blocks.map((block) => {
					const baseline = block.runs.find((run) => run.mode === "baseline").memory.retainedEndDeltaBytes;
					const patched = block.runs.find((run) => run.mode === mode).memory.retainedEndDeltaBytes;
					return patched - baseline;
				});
				memory[mode].medianPairedReplayPeakDeltaBytes = median(pairedPeak);
				memory[mode].medianPairedRetainedEndDeltaBytes = median(pairedRetained);
			}
		}

		workloads[workload] = {
			blocks: blocks.length,
			outputSha256: outputHashes[0],
			ratios,
			memory,
		};
	}

	const summary = {
		schema: "pi-render-cache/promoted-evidence/v1",
		release,
		promotedAt: new Date().toISOString(),
		raw: { fileBasename: path.basename(input), sha256: sha256File(input) },
		corpus: { file: "fixtures/stream-replay.json", sha256: fixtureHash },
		counts: {
			blocksPerWorkload: results.config.blocks,
			totalBlocks: results.blocks.length,
			repsPerRun: results.config.reps,
			seed: results.config.seed,
		},
		environment: {
			node: results.env?.node,
			icu: results.env?.icu,
			platform: results.env?.platform,
			arch: results.env?.arch,
			osRelease: results.env?.osRelease,
			cpuModel: results.env?.cpuModel,
			nodeOptions: redactHome(results.env?.nodeOptions),
			pi: { version: results.pi?.version, rootBasename: path.basename(results.pi?.root ?? "") },
			piTui: {
				version: results.piTui?.version,
				rootBasename: path.basename(results.piTui?.root ?? ""),
				entryBasename: path.basename(results.piTui?.entry ?? ""),
			},
			theme: { pathBasename: path.basename(results.theme?.path ?? "") },
		},
		workloads,
	};
	const destination = path.join(PROJECT_ROOT, "evidence", release, "summary.json");
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.writeFileSync(destination, JSON.stringify(summary, null, "\t") + "\n");
	process.stdout.write(`PASS promoted sanitized evidence to ${path.relative(PROJECT_ROOT, destination)}\n`);
} catch (error) {
	process.stderr.write(`FAIL evidence promotion: ${error.message}\n`);
	process.exit(1);
}
