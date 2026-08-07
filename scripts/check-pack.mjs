#!/usr/bin/env node
/** Validate the npm tarball against the intentionally shipped exact manifest. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REQUIRED = [
	"LICENSE",
	"README.md",
	"assets/screenshot.png",
	"compatibility.json",
	"docs/UPSTREAM_STATUS.md",
	"extensions/index.ts",
	"package.json",
	"scripts/check-upstream.mjs",
	"scripts/resolve-pi.mjs",
	"src/md-cache.js",
	"src/patch-state.js",
	"src/seg-cache.js",
	"src/split.js",
	"src/stats.js",
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packed = spawnSync(npm, ["pack", "--dry-run", "--json"], {
	cwd: PROJECT_ROOT,
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
});
if (packed.stderr) process.stderr.write(packed.stderr);
if (packed.error || packed.status !== 0) {
	process.stderr.write(`FAIL package dry-run: ${packed.error?.message ?? `npm exited ${packed.status}`}\n`);
	process.exit(1);
}

let report;
try {
	report = JSON.parse(packed.stdout);
} catch (error) {
	process.stderr.write(`FAIL npm pack did not emit valid JSON: ${error.message}\n`);
	process.exit(1);
}
const files = report?.[0]?.files;
if (!Array.isArray(files)) {
	process.stderr.write("FAIL npm pack JSON has no files manifest\n");
	process.exit(1);
}

const expected = new Set(REQUIRED);
const actual = new Set(files.map((entry) => entry.path));
const missing = [...expected].filter((file) => !actual.has(file)).sort();
const unexpected = [...actual].filter((file) => !expected.has(file)).sort();

if (missing.length || unexpected.length) {
	if (missing.length) process.stderr.write(`FAIL missing package files: ${missing.join(", ")}\n`);
	if (unexpected.length) process.stderr.write(`FAIL unexpected package files: ${unexpected.join(", ")}\n`);
	process.exit(1);
}

process.stdout.write(`PASS exact package manifest (${actual.size} files, upstream status included)\n`);
