#!/usr/bin/env node
/**
 * Benchmark results evaluator (plan Task 3 + Checkpoint A premise gate).
 * Completeness and activity are derived from raw runs; producer labels such as
 * block.complete are intentionally never trusted by the premise gate.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapMedianCI, flag, readJSON, sha256File } from "./benchmark-lib.mjs";
import { resolvePiRoot, resolvePiTui, resolveThemeModule } from "./resolve-pi.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_PATH = path.join(PROJECT_ROOT, "fixtures", "stream-replay.json");
const MODES = ["baseline", "seg", "md", "both"];
const args = process.argv.slice(2);
const evalMode = flag(args, "mode", "report");
const input = flag(args, "input", path.join(".bench-results", "latest.json"));
const minBlocks = Number(flag(args, "min-blocks", "20"));
const JSON_MODE = args.includes("--json");

function say(line) {
	if (JSON_MODE) process.stderr.write(line + "\n");
	else process.stdout.write(line + "\n");
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactUniqueSet(value, expected) {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		new Set(value).size === expected.length &&
		expected.every((item) => value.includes(item))
	);
}

function sameMetadata(a, b, fields) {
	return isObject(a) && isObject(b) && fields.every((field) => a[field] === b[field]);
}

const results = readJSON(input);
const fixture = readJSON(FIXTURE_PATH);
const blocks = Array.isArray(results?.blocks) ? results.blocks : [];
const configuredWorkloads = Array.isArray(results?.config?.workloads) ? results.config.workloads : [];
const fixtureWorkloads = isObject(fixture.workloads) ? Object.keys(fixture.workloads) : [];
const out = { input, evalMode, gates: [], ratios: {}, memory: {}, pass: true };

function gate(name, ok, detail) {
	out.gates.push({ name, ok, detail: detail ?? null });
	if (!ok) out.pass = false;
	say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const generalSchemaProblems = [];
if (!isObject(results)) generalSchemaProblems.push("root must be an object");
if (results?.schema !== "pi-render-cache/benchmark-results/v1") generalSchemaProblems.push("unsupported schema identifier");
if (!isObject(results?.config)) generalSchemaProblems.push("config must be an object");
if (!Number.isInteger(results?.config?.blocks) || results.config.blocks < 1) generalSchemaProblems.push("config.blocks must be a positive integer");
if (!Number.isInteger(results?.config?.reps) || results.config.reps < 1) generalSchemaProblems.push("config.reps must be a positive integer");
if (!Number.isFinite(results?.config?.seed)) generalSchemaProblems.push("config.seed must be finite");
if (
	configuredWorkloads.length === 0 ||
	new Set(configuredWorkloads).size !== configuredWorkloads.length ||
	configuredWorkloads.some((name) => typeof name !== "string" || !fixtureWorkloads.includes(name))
) {
	generalSchemaProblems.push("config.workloads must be nonempty, unique, and present in the replay fixture");
}
if (!isExactUniqueSet(results?.config?.modes, MODES)) generalSchemaProblems.push("config.modes must contain the four benchmark modes exactly once");
if (!Array.isArray(results?.blocks)) generalSchemaProblems.push("blocks must be an array");
if (typeof results?.env?.osRelease !== "string" || results.env.osRelease.length === 0) generalSchemaProblems.push("env.osRelease is required");
if (results?.corpus?.sha256 !== sha256File(FIXTURE_PATH)) generalSchemaProblems.push("corpus hash does not match the checked-in fixture");
if (!isObject(results?.pi) || typeof results.pi.version !== "string" || typeof results.pi.root !== "string") generalSchemaProblems.push("pi version/root metadata is required");
if (
	!isObject(results?.piTui) ||
	typeof results.piTui.version !== "string" ||
	typeof results.piTui.root !== "string" ||
	typeof results.piTui.entry !== "string"
) {
	generalSchemaProblems.push("pi-tui version/root/entry metadata is required");
}
if (!isObject(results?.theme) || typeof results.theme.path !== "string") generalSchemaProblems.push("theme-module realpath is required");
if (!isObject(results?.replay) || !isExactUniqueSet(results.replay.renderWidths, [100]) || !isObject(results.replay.workloads)) {
	generalSchemaProblems.push("replay widths/workload metadata is required");
} else {
	for (const name of configuredWorkloads) {
		const expected = fixture.workloads?.[name];
		const archived = results.replay.workloads[name];
		if (expected?.kind === "markdown") {
			if (
				!isObject(archived) ||
				archived.kind !== "markdown" ||
				archived.renderWidth !== 100 ||
				archived.chunkCount !== expected.cutPoints?.length
			) {
				generalSchemaProblems.push(`replay metadata mismatch for ${name}`);
			}
		} else if (
			!isObject(archived) ||
			archived.kind !== "visible-width" ||
			archived.lineCount !== expected?.lines?.length ||
			archived.passes !== expected?.passes
		) {
			generalSchemaProblems.push(`replay metadata mismatch for ${name}`);
		}
	}
}

function blockProblems(block, position) {
	const problems = [];
	if (!isObject(block)) return [`block ${position} is not an object`];
	if (!configuredWorkloads.includes(block.workload)) problems.push(`block ${position} has unconfigured workload ${String(block.workload)}`);
	if (!Number.isInteger(block.index) || block.index < 0) problems.push(`block ${position} has invalid index`);
	if (!isExactUniqueSet(block.modeOrder, MODES)) problems.push(`block ${position} modeOrder is not the four modes exactly once`);
	if (!Array.isArray(block.runs) || block.runs.length !== MODES.length) {
		problems.push(`block ${position} must contain exactly four runs`);
		return problems;
	}
	for (const mode of MODES) {
		if (block.runs.filter((run) => run?.mode === mode).length !== 1) problems.push(`block ${position} must contain ${mode} exactly once`);
	}
	for (const [runIndex, run] of block.runs.entries()) {
		const label = `block ${position} run ${runIndex}`;
		if (!isObject(run)) {
			problems.push(`${label} is not an object`);
			continue;
		}
		if (run.workload !== block.workload) problems.push(`${label} workload does not match its block`);
		if (!MODES.includes(run.mode)) problems.push(`${label} has an unknown mode`);
		if (run.reps !== results.config?.reps) problems.push(`${label} reps do not match the header`);
		if (typeof run.byteIdentical !== "boolean") problems.push(`${label} lacks byteIdentical boolean`);
		if (!isObject(run.installed) || typeof run.installed.md !== "boolean" || typeof run.installed.seg !== "boolean") {
			problems.push(`${label} lacks installed booleans`);
		}
		if (!isObject(run.owned) || typeof run.owned.md !== "boolean" || typeof run.owned.seg !== "boolean") {
			problems.push(`${label} lacks owned booleans`);
		}
		if (!Array.isArray(run.samples) || run.samples.length !== results.config?.reps) {
			problems.push(`${label} sample count does not match config.reps`);
		} else if (run.samples.some((sample) => !Number.isFinite(sample?.wallMs) || sample.wallMs < 0)) {
			problems.push(`${label} has invalid wall samples`);
		}
		if (!sameMetadata(run.pi, results.pi, ["version", "root"])) problems.push(`${label} pi metadata differs from header`);
		if (!sameMetadata(run.piTui, results.piTui, ["version", "root", "entry"])) problems.push(`${label} pi-tui metadata differs from header`);
		if (!sameMetadata(run.theme, results.theme, ["path"])) problems.push(`${label} theme metadata differs from header`);
		const replayItem = fixture.workloads?.[block.workload];
		if (replayItem?.kind === "markdown") {
			if (!Array.isArray(run.replayOutputHashes) || run.replayOutputHashes.length !== replayItem.cutPoints.length) {
				problems.push(`${label} per-chunk hash sequence is incomplete`);
			}
		}
	}
	return problems;
}

const perBlockProblems = blocks.map(blockProblems);
const countedBlocks = blocks.filter((_block, index) => perBlockProblems[index].length === 0);
const allRuns = blocks.flatMap((block) => (Array.isArray(block?.runs) ? block.runs.filter(isObject) : []));
const meanWall = (run) => run.samples.reduce((total, sample) => total + sample.wallMs, 0) / run.samples.length;

// Reporting uses only structurally complete blocks, independently of producer labels.
say(`\n== ${input}  (${blocks.length} archived blocks, seed ${results?.config?.seed}) ==`);
for (const workload of configuredWorkloads.filter((name) => fixtureWorkloads.includes(name))) {
	const complete = countedBlocks.filter((block) => block.workload === workload);
	out.ratios[workload] = {};
	for (const mode of ["seg", "md", "both"]) {
		const logRatios = [];
		for (const block of complete) {
			const base = block.runs.find((run) => run.mode === "baseline");
			const run = block.runs.find((candidate) => candidate.mode === mode);
			if (base?.samples?.length && run?.samples?.length) logRatios.push(Math.log(meanWall(base) / meanWall(run)));
		}
		if (logRatios.length === 0) continue;
		const ci = bootstrapMedianCI(logRatios, { resamples: 10_000, seed: 12345 });
		const speedup = Math.exp(ci.median);
		out.ratios[workload][mode] = {
			blocks: logRatios.length,
			medianLogRatio: ci.median,
			ci95LogRatio: ci.ci95,
			medianSpeedup: speedup,
			ci95Speedup: [Math.exp(ci.ci95[0]), Math.exp(ci.ci95[1])],
		};
		say(
			`ratio  ${workload}/${mode}: baseline/${mode} = ${speedup.toFixed(2)}x ` +
				`[${Math.exp(ci.ci95[0]).toFixed(2)}, ${Math.exp(ci.ci95[1]).toFixed(2)}] (${logRatios.length} blocks, report-only)`,
		);
	}
	out.memory[workload] = {};
	for (const mode of MODES) {
		const runs = complete.flatMap((block) => block.runs.filter((run) => run.mode === mode && isObject(run.memory)));
		if (runs.length === 0) continue;
		const middle = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
		const peak = middle(runs.map((run) => run.memory.replayPeakDeltaBytes));
		const retained = middle(runs.map((run) => run.memory.retainedEndDeltaBytes));
		out.memory[workload][mode] = { medianReplayPeakDeltaBytes: peak, medianRetainedEndDeltaBytes: retained };
		say(
			`mem    ${workload}/${mode}: replay-peak Δ ${(peak / 1048576).toFixed(1)} MiB, ` +
				`retained-end Δ ${(retained / 1048576).toFixed(1)} MiB (report-only)`,
		);
	}
}
say("");

if (evalMode === "premise") {
	if (!Number.isInteger(minBlocks) || minBlocks < 1) generalSchemaProblems.push("--min-blocks must be a positive integer");
	gate(
		"result schema and fixture metadata valid",
		generalSchemaProblems.length === 0,
		generalSchemaProblems.length ? generalSchemaProblems.slice(0, 8).join("; ") : `${configuredWorkloads.length} configured workload(s)`,
	);

	let structural = false;
	let structuralDetail = null;
	try {
		const raw = execFileSync(process.execPath, [path.join(PROJECT_ROOT, "scripts", "check-upstream.mjs"), "--json"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const report = JSON.parse(raw);
		structural = report.supported === true;
		structuralDetail = `pi ${report.pi?.version}, pi-tui ${report.piTui?.version}`;
		out.structure = report;
	} catch (error) {
		structuralDetail = String(error?.message ?? error);
	}
	gate("structural hot paths present (check-upstream)", structural, structuralDetail);

	let currentMetadata = null;
	let metadataError = null;
	try {
		const pi = resolvePiRoot();
		const piTui = resolvePiTui(pi.root);
		const theme = resolveThemeModule(pi.root);
		currentMetadata = { pi, piTui, theme };
	} catch (error) {
		metadataError = String(error?.message ?? error);
	}
	const headerMatchesCurrent =
		currentMetadata !== null &&
		sameMetadata(results.pi, currentMetadata.pi, ["version", "root"]) &&
		sameMetadata(results.piTui, currentMetadata.piTui, ["version", "root", "entry"]) &&
		sameMetadata(results.theme, currentMetadata.theme, ["path"]);
	gate(
		"archived compatibility unit matches current resolved realpaths/versions",
		headerMatchesCurrent,
		metadataError ??
			`archived pi ${results?.pi?.version}, pi-tui ${results?.piTui?.version}; current pi ${currentMetadata?.pi.version}, pi-tui ${currentMetadata?.piTui.version}`,
	);
	const workersMatchHeader = allRuns.every(
		(run) =>
			sameMetadata(run.pi, results.pi, ["version", "root"]) &&
			sameMetadata(run.piTui, results.piTui, ["version", "root", "entry"]) &&
			sameMetadata(run.theme, results.theme, ["path"]),
	);
	gate("all workers target the archived compatibility unit", allRuns.length > 0 && workersMatchHeader, `${allRuns.length} run(s)`);

	const flatBlockProblems = perBlockProblems.flat();
	gate(
		"every block contains baseline/seg/md/both exactly once",
		blocks.length > 0 && flatBlockProblems.length === 0,
		flatBlockProblems.length ? flatBlockProblems.slice(0, 8).join("; ") : `${countedBlocks.length} structurally complete block(s)`,
	);
	for (const workload of configuredWorkloads) {
		const archived = blocks.filter((block) => block?.workload === workload);
		const complete = countedBlocks.filter((block) => block.workload === workload);
		const indices = archived.map((block) => block.index);
		const declaredShape =
			archived.length === results.config?.blocks &&
			new Set(indices).size === archived.length &&
			indices.every((index) => Number.isInteger(index) && index >= 0 && index < results.config.blocks);
		gate(`configured workload present: ${workload}`, archived.length > 0, `${archived.length} archived block(s)`);
		gate(
			`declared block set complete for ${workload}`,
			declaredShape,
			`${archived.length}/${results.config?.blocks ?? "?"} archived with unique declared indices`,
		);
		gate(`>= ${minBlocks} structurally complete blocks for ${workload}`, complete.length >= minBlocks, `${complete.length} complete`);
	}

	const badRuns = allRuns.filter((run) => run.byteIdentical !== true);
	gate(
		"all runs byte-identical at every replay cut point",
		allRuns.length > 0 && badRuns.length === 0,
		badRuns.length ? `${badRuns.length} failing run(s)` : `${allRuns.length} runs`,
	);
	const installOwnershipGood = allRuns.every((run) => {
		const expectMd = run.mode === "md" || run.mode === "both";
		const expectSeg = run.mode === "seg" || run.mode === "both";
		return (
			run.installed?.md === expectMd &&
			run.owned?.md === expectMd &&
			run.installed?.seg === expectSeg &&
			run.owned?.seg === expectSeg
		);
	});
	gate("requested patches installed and owned; unrequested patches pristine", allRuns.length > 0 && installOwnershipGood, `${allRuns.length} run(s)`);

	const mdRuns = allRuns.filter((run) => run.workload === "ordinary" && (run.mode === "md" || run.mode === "both"));
	const mdActive = mdRuns.length > 0 && mdRuns.every((run) => (run.counters?.md?.hits ?? 0) + (run.counters?.md?.misses ?? 0) > 0);
	gate("md-cache nonzero work in md/both ordinary runs", mdActive, mdRuns.length ? `${mdRuns.length} runs` : "no qualifying runs");
	const segRuns = allRuns.filter((run) => run.mode === "seg" || run.mode === "both");
	const segActive = segRuns.length > 0 && segRuns.every((run) => (run.counters?.seg?.hits ?? 0) > 0);
	gate("seg-cache nonzero hits in seg/both runs", segActive, segRuns.length ? `${segRuns.length} runs` : "no qualifying runs");
	const thinkingMdRuns = allRuns.filter((run) => run.workload === "thinking" && (run.mode === "md" || run.mode === "both"));
	const thinkingFallbacks = thinkingMdRuns.length > 0 && thinkingMdRuns.every((run) => (run.counters?.md?.fallbacks ?? 0) > 0);
	gate(
		"styled thinking exercises md-cache pristine fallback",
		thinkingFallbacks,
		thinkingMdRuns.length ? `${thinkingMdRuns.length} runs with fallbacks>0 required` : "no thinking md/both runs",
	);

	say("\nmemory is REPORT-ONLY at the premise checkpoint (gated at Checkpoint B)");
}

if (evalMode === "premise") say(out.pass ? "\nPREMISE: PASS" : "\nPREMISE: FAIL");
else say("report-only mode: no gates evaluated");
if (JSON_MODE) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exit(out.pass ? 0 : 1);
