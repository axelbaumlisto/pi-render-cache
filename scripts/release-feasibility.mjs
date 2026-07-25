#!/usr/bin/env node
/** Checkpoint B: deterministic tests, compatibility, premise, and RSS gate. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { median, readJSON } from "./benchmark-lib.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const MEMORY_LIMIT_BYTES = 20 * 1024 * 1024;
const MODES = ["seg", "md", "both"];

function option(name, fallback = null) {
	const index = args.indexOf(`--${name}`);
	if (index === -1) return fallback;
	if (index + 1 >= args.length || args[index + 1].startsWith("--")) throw new Error(`--${name} requires a value`);
	return args[index + 1];
}

const suppliedInput = option("input");
const output = option("output");
const blocks = QUICK ? 3 : 20;
const minBlocks = QUICK ? 3 : 20;
const rawInput = suppliedInput ?? path.join(".bench-results", "feasibility-raw.json");
const input = path.resolve(PROJECT_ROOT, rawInput);
const summary = {
	schema: "pi-render-cache/release-feasibility/v1",
	generatedAt: new Date().toISOString(),
	quick: QUICK,
	input: path.relative(PROJECT_ROOT, input),
	minBlocks,
	memoryLimitBytes: MEMORY_LIMIT_BYTES,
	gates: [],
	memory: {},
	pass: true,
};

function gate(name, ok, detail = null) {
	summary.gates.push({ name, ok, detail });
	if (!ok) summary.pass = false;
	process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function run(name, command, commandArgs, env) {
	const result = spawnSync(command, commandArgs, {
		cwd: PROJECT_ROOT,
		env,
		encoding: "utf8",
		stdio: ["inherit", "inherit", "inherit"],
	});
	const ok = !result.error && result.status === 0;
	gate(name, ok, result.error?.message ?? `exit ${result.status}`);
	return ok;
}

function writeSummary() {
	if (!output) return;
	const destination = path.resolve(PROJECT_ROOT, output);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.writeFileSync(destination, JSON.stringify(summary, null, "\t") + "\n");
	process.stdout.write(`wrote ${path.relative(PROJECT_ROOT, destination)}\n`);
}

try {
	let archived = null;
	if (suppliedInput) {
		try {
			archived = readJSON(input);
		} catch (error) {
			gate("benchmark input readable", false, error.message);
		}
	}

	// Reusing archived evidence must evaluate the exact compatibility unit that
	// produced it. A fresh run resolves the pinned local development fixture.
	const archivedPiRoot = archived?.pi?.root;
	const selectedEnv = {
		...process.env,
		...(typeof archivedPiRoot === "string" && archivedPiRoot
			? { PI_PACKAGE_ROOT: archivedPiRoot }
			: {}),
	};
	if (suppliedInput && archivedPiRoot) {
		gate(
			"archived pi root available",
			fs.existsSync(archivedPiRoot),
			path.basename(archivedPiRoot),
		);
	}

	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	run("deterministic test suite", npm, ["test"], selectedEnv);
	run("upstream compatibility canaries", process.execPath, ["scripts/check-upstream.mjs"], selectedEnv);

	if (!suppliedInput) {
		run(
			`blocked benchmark (${blocks} blocks per workload)`,
			process.execPath,
			["scripts/benchmark.mjs", "--blocks", String(blocks), "--output", rawInput],
			selectedEnv,
		);
	}

	let premise = null;
	if (fs.existsSync(input)) {
		const evaluated = spawnSync(
			process.execPath,
			[
				"scripts/evaluate-benchmark.mjs",
				"--mode",
				"premise",
				"--input",
				input,
				"--min-blocks",
				String(minBlocks),
				"--json",
			],
			{ cwd: PROJECT_ROOT, env: selectedEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		if (evaluated.stderr) process.stderr.write(evaluated.stderr);
		try {
			premise = JSON.parse(evaluated.stdout);
			summary.premise = premise;
		} catch (error) {
			gate("premise evaluator output parseable", false, error.message);
		}
		gate(
			"premise structural/activity/correctness gates",
			!evaluated.error && evaluated.status === 0 && premise?.pass === true,
			evaluated.error?.message ?? `exit ${evaluated.status}`,
		);
	} else {
		gate("benchmark input exists", false, path.relative(PROJECT_ROOT, input));
	}

	let results = null;
	try {
		results = readJSON(input);
	} catch (error) {
		gate("memory-gate input readable", false, error.message);
	}
	if (results) {
		for (const workload of results.config?.workloads ?? []) {
			const workloadBlocks = (results.blocks ?? []).filter((block) => block?.workload === workload);
			summary.memory[workload] = {};
			for (const mode of MODES) {
				const paired = [];
				for (const block of workloadBlocks) {
					const baseline = block.runs?.find((run) => run?.mode === "baseline")?.memory?.replayPeakDeltaBytes;
					const patched = block.runs?.find((run) => run?.mode === mode)?.memory?.replayPeakDeltaBytes;
					if (Number.isFinite(baseline) && Number.isFinite(patched)) paired.push(patched - baseline);
				}
				const pairedMedian = paired.length ? median(paired) : null;
				const ok = paired.length >= minBlocks && pairedMedian <= MEMORY_LIMIT_BYTES;
				summary.memory[workload][mode] = {
					blocks: paired.length,
					medianPairedReplayPeakDeltaBytes: pairedMedian,
					limitBytes: MEMORY_LIMIT_BYTES,
					pass: ok,
				};
				gate(
					`paired replay-peak RSS ${workload}/${mode} <= 20 MiB`,
					ok,
					pairedMedian === null
						? "no paired memory samples"
						: `${(pairedMedian / 1048576).toFixed(2)} MiB median over ${paired.length} blocks`,
				);
			}
		}
	}
} catch (error) {
	gate("release-feasibility orchestration", false, error.stack ?? error.message);
}

writeSummary();
process.stdout.write(summary.pass ? "\nRELEASE FEASIBILITY: PASS\n" : "\nRELEASE FEASIBILITY: FAIL\n");
process.exit(summary.pass ? 0 : 1);
