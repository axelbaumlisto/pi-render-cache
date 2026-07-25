#!/usr/bin/env node
/**
 * Benchmark worker: runs ONE (workload, mode) combination in this process and
 * prints a single JSON line to stdout (all human logs go to stderr).
 *
 * Modes:
 *   baseline  no patch; asserts both prototypes are pristine (no render-cache
 *             Symbol.for state, native/original functions) before running;
 *   seg       seg-cache only;   md   md-cache only;   both  both patches.
 *
 * Protocol per plan Task 3: warmup once untimed, then N timed reps of the
 * SAME deterministic replay. hrtime.bigint wraps only synchronous render
 * work; process.cpuUsage delta is captured per rep. Byte-correctness compares
 * every replay cut point against a pristine replay after the timed region.
 * RSS is sampled pre/during/after the timed region;
 * resourceUsage().maxRSS is supplementary only.
 *
 * Usage: node scripts/benchmark-worker.mjs --workload ordinary --mode both [--reps 3]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashString } from "../src/md-cache.js";
import { resolvePiRoot, resolvePiTui, resolveThemeModule } from "./resolve-pi.mjs";
import { flag, quantile } from "./benchmark-lib.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDER_WIDTH = 100;

const args = process.argv.slice(2);
const workloadName = flag(args, "workload", null);
const mode = flag(args, "mode", null);
const reps = Number(flag(args, "reps", "3"));
const fixturePath = flag(args, "fixture", path.join(PROJECT_ROOT, "fixtures", "stream-replay.json"));

function log(msg) {
	process.stderr.write(`[worker ${workloadName}/${mode}] ${msg}\n`);
}
function die(msg) {
	log(`FATAL: ${msg}`);
	process.exit(1);
}

if (!["baseline", "seg", "md", "both"].includes(mode)) die(`bad --mode ${mode}`);
if (!Number.isInteger(reps) || reps < 1) die(`bad --reps ${reps}`);

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const workload = fixture.workloads?.[workloadName];
if (!workload) die(`unknown --workload ${workloadName}`);

// --- Resolve the compatibility unit and load modules from the selected root ---
const pi = resolvePiRoot();
const tuiInfo = resolvePiTui(pi.root);
const themeInfo = resolveThemeModule(pi.root);
const tui = await import(pathToFileURL(tuiInfo.entry).href);
const themeMod = await import(pathToFileURL(themeInfo.path).href);
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
if (!globalThis[THEME_KEY]) themeMod.initTheme("dark");
const mdTheme = themeMod.getMarkdownTheme();
const { Markdown, getCapabilities, visibleWidth } = tui;

const MD_STATE = Symbol.for("render-cache:md:v1");
const SEG_STATE = Symbol.for("render-cache:seg:v1");
const wantMd = mode === "md" || mode === "both";
const wantSeg = mode === "seg" || mode === "both";

// --- Pristine assertions (all modes start pristine; baseline must stay so) ---
if (globalThis[MD_STATE] || globalThis[SEG_STATE]) {
	die("render-cache Symbol.for state already present in a fresh worker process");
}
if (!/\[native code\]/.test(Intl.Segmenter.prototype.segment.toString())) {
	die("Intl.Segmenter.prototype.segment is not native in a fresh worker process");
}
const pristineRender = Markdown.prototype.render;
const pristineSegment = Intl.Segmenter.prototype.segment;
const compatibility = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "compatibility.json"), "utf8"));
const observedRenderHash = hashString(pristineRender.toString());
const configuredRenderHashes = compatibility.implementationHashes?.[pi.version]?.markdownRender;
const renderAllowlist = Array.isArray(configuredRenderHashes)
	? configuredRenderHashes
	: configuredRenderHashes
		? [configuredRenderHashes]
		: [];
if (!renderAllowlist.includes(observedRenderHash)) {
	die(
		`Markdown.prototype.render djb2 hash ${observedRenderHash} is not allowlisted for pi ${pi.version}` +
			` (expected ${renderAllowlist.length ? renderAllowlist.join(", ") : "no configured hash"})`,
	);
}

// --- Workload runners (synchronous render work only; no sleeping) ---
// Cadence is ordering only: fixed cutPoints define chunk boundaries, and each
// step renders a fresh Markdown over the cumulative prefix (pi's rebuild path).
function makeStyle() {
	// Mirrors pi assistant-message thinking blocks: { color: fg(thinkingText), italic: true }.
	return { color: (text) => themeMod.theme.fg("thinkingText", text), italic: true };
}

/** @returns {{lastLines: string[], latenciesMs: number[], outputHashes: string[] | null}} */
function runMarkdownReplay(captureHashes = false) {
	const { text, cutPoints, styled } = workload;
	const latenciesMs = [];
	const outputHashes = captureHashes ? [] : null;
	let lastLines = [];
	for (const cut of cutPoints) {
		// Construction is part of pi's synchronous message-update rebuild path.
		const t0 = process.hrtime.bigint();
		const md = styled
			? new Markdown(text.slice(0, cut), 1, 0, mdTheme, makeStyle())
			: new Markdown(text.slice(0, cut), 1, 0, mdTheme);
		lastLines = md.render(RENDER_WIDTH);
		latenciesMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
		if (outputHashes) outputHashes.push(sha256(lastLines.join("\n")));
	}
	return { lastLines, latenciesMs, outputHashes };
}

/** @returns {{widths: number[], latenciesMs: number[]}} */
function runWidthReplay() {
	const { lines, passes } = workload;
	const latenciesMs = [];
	const widths = new Array(lines.length);
	for (let p = 0; p < passes; p++) {
		const t0 = process.hrtime.bigint();
		for (let i = 0; i < lines.length; i++) widths[i] = visibleWidth(lines[i]);
		latenciesMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
	}
	return { widths, latenciesMs };
}

const isWidthWorkload = workload.kind === "visible-width";
const runOnce = isWidthWorkload ? runWidthReplay : runMarkdownReplay;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const outputOf = (r) => (isWidthWorkload ? r.widths.join(",") : r.lastLines.join("\n"));

// For the width workload the module-level widthCache would make a post-run
// pristine comparison vacuous, so capture the pristine expectation FIRST.
let pristineWidthOutput = null;
if (isWidthWorkload) pristineWidthOutput = outputOf(runWidthReplay());

// --- Install patches for the requested mode ---
const patchMods = {};
const installed = { md: false, seg: false };
if (wantSeg) {
	patchMods.seg = await import(pathToFileURL(path.join(PROJECT_ROOT, "src", "seg-cache.js")).href);
	const res = patchMods.seg.install();
	if (!res.installed) die(`seg-cache install refused: ${res.reason}`);
	installed.seg = true;
	if (Intl.Segmenter.prototype.segment !== globalThis[SEG_STATE].patched) {
		die("seg-cache installed but prototype ownership is not ours");
	}
}
if (wantMd) {
	patchMods.md = await import(pathToFileURL(path.join(PROJECT_ROOT, "src", "md-cache.js")).href);
	const res = patchMods.md.install({ Markdown, getCapabilities });
	if (!res.installed) die(`md-cache install refused: ${res.reason}`);
	installed.md = true;
	if (Markdown.prototype.render !== globalThis[MD_STATE].patched) {
		die("md-cache installed but prototype ownership is not ours");
	}
}

// --- Warmup (untimed, identical corpus) ---
runOnce();
log("warmup done");

// --- Timed region ---
if (typeof globalThis.gc === "function") globalThis.gc(); // optional --expose-gc policy
const rssPre = process.memoryUsage().rss;
let rssPeak = rssPre;
const samples = [];
let lastResult = null;
for (let rep = 0; rep < reps; rep++) {
	const cpu0 = process.cpuUsage();
	const t0 = process.hrtime.bigint();
	lastResult = runOnce();
	const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
	const cpu = process.cpuUsage(cpu0);
	const rss = process.memoryUsage().rss; // coarse peak sampling: after each rep
	if (rss > rssPeak) rssPeak = rss;
	samples.push({
		rep,
		wallMs,
		cpuUserMs: cpu.user / 1000,
		cpuSystemMs: cpu.system / 1000,
		updateP95Ms: quantile(lastResult.latenciesMs, 0.95),
		updateCount: lastResult.latenciesMs.length,
		rssAfterRep: rss,
	});
	log(`rep ${rep}: wall ${wallMs.toFixed(1)}ms cpu ${(cpu.user / 1000).toFixed(1)}ms`);
}
const rssEnd = process.memoryUsage().rss;
const patchedOutput = outputOf(lastResult);

// --- Post-run ownership assertions (nothing displaced us during the run) ---
if (wantMd && Markdown.prototype.render !== globalThis[MD_STATE].patched) die("md ownership lost during run");
if (wantSeg && Intl.Segmenter.prototype.segment !== globalThis[SEG_STATE].patched) die("seg ownership lost during run");
if (!wantMd && Markdown.prototype.render !== pristineRender) die("Markdown.prototype.render changed in an unpatched mode");
if (!wantSeg && Intl.Segmenter.prototype.segment !== pristineSegment) die("Intl.Segmenter.prototype.segment changed in an unpatched mode");
const owned = {
	md: Boolean(wantMd && Markdown.prototype.render === globalThis[MD_STATE]?.patched),
	seg: Boolean(wantSeg && Intl.Segmenter.prototype.segment === globalThis[SEG_STATE]?.patched),
};

// --- Counters (before uninstall drops the shared state) ---
const counters = {
	md: wantMd ? patchMods.md.getStats() : null,
	seg: wantSeg ? patchMods.seg.getStats() : null,
};

// --- Correctness: compare every replay cut point against pristine output ---
function restorePristine() {
	if (wantMd) {
		const result = patchMods.md.uninstall();
		if (!result.restored) die(`md-cache uninstall failed: ${result.reason}`);
	}
	if (wantSeg) {
		const result = patchMods.seg.uninstall();
		if (!result.restored) die(`seg-cache uninstall failed: ${result.reason}`);
	}
	if (Markdown.prototype.render !== pristineRender) die("Markdown.prototype.render not restored");
	if (Intl.Segmenter.prototype.segment !== pristineSegment) die("Intl.Segmenter.prototype.segment not restored");
}

let byteIdentical;
let replayOutputHashes = null;
if (isWidthWorkload) {
	restorePristine();
	byteIdentical = patchedOutput === pristineWidthOutput;
} else {
	// Correctness replay is intentionally outside both update and run-total timing.
	// Capture the patched hash sequence before uninstall, then repeat pristine.
	const patchedCorrectness = runMarkdownReplay(true);
	replayOutputHashes = patchedCorrectness.outputHashes;
	restorePristine();
	const pristineResult = runMarkdownReplay(true);
	byteIdentical =
		replayOutputHashes.length === pristineResult.outputHashes.length &&
		replayOutputHashes.every((hash, index) => hash === pristineResult.outputHashes[index]);
}

const report = {
	workload: workloadName,
	mode,
	reps,
	warmupRuns: 1,
	renderWidth: RENDER_WIDTH,
	ok: byteIdentical,
	byteIdentical,
	outputSha256: sha256(patchedOutput),
	replayOutputHashes,
	installed,
	owned,
	samples,
	counters,
	memory: {
		rssPreBytes: rssPre,
		rssPeakBytes: rssPeak,
		rssEndBytes: rssEnd,
		replayPeakDeltaBytes: rssPeak - rssPre,
		retainedEndDeltaBytes: rssEnd - rssPre,
		// Lifetime maxRSS, supplementary only (units are platform-dependent:
		// kilobytes on Linux, bytes on macOS).
		maxRSSSupplementary: process.resourceUsage().maxRSS,
	},
	pi: { version: pi.version, root: pi.root },
	piTui: { version: tuiInfo.version, root: tuiInfo.root, entry: tuiInfo.entry },
	theme: { path: themeInfo.path },
};
process.stdout.write(JSON.stringify(report) + "\n");
process.exit(byteIdentical ? 0 : 1);
