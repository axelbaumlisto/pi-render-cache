#!/usr/bin/env node
/**
 * Blocked benchmark orchestrator (plan Task 3).
 *
 * One BLOCK = all four modes (baseline, seg, md, both) for one workload, each
 * run sequentially as a FRESH child process (node scripts/benchmark-worker.mjs).
 * Mode order is randomized within every block with a seeded PRNG (mulberry32;
 * seed recorded in the output). Raw per-rep samples are archived — best-of-N
 * is never computed as a decision statistic.
 *
 * Usage:
 *   node scripts/benchmark.mjs [--blocks 5] [--seed 1] [--reps 3]
 *     [--workloads ordinary,thinking,unicode-width] [--output .bench-results/latest.json]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePiRoot, resolvePiTui, resolveThemeModule } from "./resolve-pi.mjs";
import { flag, mulberry32, sha256File, shuffled } from "./benchmark-lib.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER = path.join(PROJECT_ROOT, "scripts", "benchmark-worker.mjs");
const FIXTURE = path.join(PROJECT_ROOT, "fixtures", "stream-replay.json");
const MODES = ["baseline", "seg", "md", "both"];

const args = process.argv.slice(2);
const blocks = Number(flag(args, "blocks", "5"));
const seed = Number(flag(args, "seed", "1"));
const reps = Number(flag(args, "reps", "3"));
const workloads = flag(args, "workloads", "ordinary,thinking,unicode-width")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);
const output = flag(args, "output", path.join(".bench-results", "latest.json"));

if (!Number.isInteger(blocks) || blocks < 1) throw new Error(`bad --blocks ${blocks}`);
if (!Number.isFinite(seed)) throw new Error(`bad --seed ${seed}`);
if (!Number.isInteger(reps) || reps < 1) throw new Error(`bad --reps ${reps}`);
if (workloads.length === 0 || new Set(workloads).size !== workloads.length) throw new Error("--workloads must be nonempty and unique");

const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
for (const workload of workloads) {
	if (!fixture.workloads?.[workload]) throw new Error(`unknown workload ${workload}`);
}
const pi = resolvePiRoot();
const tui = resolvePiTui(pi.root);
const theme = resolveThemeModule(pi.root);
const rand = mulberry32(seed);
const replayWorkloads = Object.fromEntries(
	workloads.map((name) => {
		const item = fixture.workloads[name];
		return [
			name,
			item.kind === "markdown"
				? { kind: item.kind, renderWidth: 100, chunkCount: item.cutPoints.length }
				: { kind: item.kind, lineCount: item.lines.length, passes: item.passes },
		];
	}),
);

const results = {
	schema: "pi-render-cache/benchmark-results/v1",
	startedAt: new Date().toISOString(),
	config: { blocks, seed, reps, workloads, modes: MODES },
	env: {
		node: process.version,
		icu: process.versions.icu ?? null,
		platform: process.platform,
		arch: process.arch,
		osRelease: os.release(),
		cpuModel: os.cpus()[0]?.model ?? null,
		nodeOptions: process.env.NODE_OPTIONS ?? null,
	},
	corpus: { path: path.relative(PROJECT_ROOT, FIXTURE), sha256: sha256File(FIXTURE) },
	replay: { renderWidths: [100], workloads: replayWorkloads },
	pi: { version: pi.version, root: pi.root, source: pi.source },
	piTui: { version: tui.version, root: tui.root, entry: tui.entry },
	theme: { path: theme.path },
	blocks: [],
};

let anyFailure = false;
for (const workload of workloads) {
	for (let b = 0; b < blocks; b++) {
		const order = shuffled(MODES, rand); // seeded randomization per block
		const block = { workload, index: b, modeOrder: order, complete: true, runs: [] };
		process.stderr.write(`block ${workload} #${b + 1}/${blocks}: ${order.join(" -> ")}\n`);
		for (const mode of order) {
			try {
				const stdout = execFileSync(
					process.execPath,
					[WORKER, "--workload", workload, "--mode", mode, "--reps", String(reps)],
					{ encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
				);
				block.runs.push(JSON.parse(stdout.trim().split("\n").pop()));
			} catch (err) {
				anyFailure = true;
				block.complete = false;
				block.runs.push({ workload, mode, ok: false, error: String(err?.message ?? err) });
				process.stderr.write(`  FAILED ${workload}/${mode}\n`);
			}
		}
		results.blocks.push(block);
	}
}

results.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(results, null, "\t") + "\n");
process.stderr.write(`wrote ${output} (${results.blocks.length} blocks)\n`);
process.exit(anyFailure ? 1 : 0);
