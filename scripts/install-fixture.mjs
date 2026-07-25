#!/usr/bin/env node
/**
 * Install a compatibility fixture into an ISOLATED temp root (never mutates
 * the working tree). Copies fixtures/compat/<version>/{package.json,package-lock.json}
 * into a fresh temp dir and runs `npm ci --ignore-scripts` there.
 *
 * Usage:
 *   node scripts/install-fixture.mjs <version>        install one fixture, print its PI_PACKAGE_ROOT
 *   node scripts/install-fixture.mjs --all            install every fixture
 *   node scripts/install-fixture.mjs --all --check    also run check-upstream.mjs against each root
 *                                                     (this is what `npm run compat:matrix` does)
 *
 * Last line of stdout per fixture (machine-consumable):
 *   PI_PACKAGE_ROOT=<realpath of installed pi package root>
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePiTui } from "./resolve-pi.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES_DIR = path.join(PROJECT_ROOT, "fixtures", "compat");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const CHECK = args.includes("--check");
const versions = ALL
	? fs.readdirSync(FIXTURES_DIR).filter((d) => fs.existsSync(path.join(FIXTURES_DIR, d, "package-lock.json"))).sort()
	: args.filter((a) => !a.startsWith("--"));

if (versions.length === 0) {
	console.error("Usage: node scripts/install-fixture.mjs <version>|--all [--check]");
	console.error(`Available fixtures: ${fs.readdirSync(FIXTURES_DIR).sort().join(", ")}`);
	process.exit(2);
}

/** Install one fixture; returns the canonical installed pi package root. */
function installFixture(version) {
	const fixtureDir = path.join(FIXTURES_DIR, version);
	for (const f of ["package.json", "package-lock.json"]) {
		if (!fs.existsSync(path.join(fixtureDir, f))) {
			throw new Error(`Fixture ${version} missing ${f} in ${fixtureDir}`);
		}
	}
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pi-fixture-${version}-`));
	fs.copyFileSync(path.join(fixtureDir, "package.json"), path.join(tempRoot, "package.json"));
	fs.copyFileSync(path.join(fixtureDir, "package-lock.json"), path.join(tempRoot, "package-lock.json"));
	console.error(`[fixture ${version}] npm ci --ignore-scripts in ${tempRoot} ...`);
	execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
		cwd: tempRoot,
		stdio: ["ignore", "inherit", "inherit"],
	});
	const piRoot = fs.realpathSync(
		path.join(tempRoot, "node_modules", "@earendil-works", "pi-coding-agent"),
	);
	const piVersion = JSON.parse(fs.readFileSync(path.join(piRoot, "package.json"), "utf8")).version;
	if (piVersion !== version) {
		throw new Error(`Fixture ${version} installed pi ${piVersion} — lockfile drift`);
	}
	const tui = resolvePiTui(piRoot);
	console.error(`[fixture ${version}] pi ${piVersion} @ ${piRoot}`);
	console.error(`[fixture ${version}] pi-tui ${tui.version} @ ${tui.root}`);
	console.log(`PI_PACKAGE_ROOT=${piRoot}`);
	return piRoot;
}

let failed = false;
for (const version of versions) {
	try {
		const piRoot = installFixture(version);
		if (CHECK) {
			const res = spawnSync(
				process.execPath,
				[path.join(PROJECT_ROOT, "scripts", "check-upstream.mjs")],
				{ env: { ...process.env, PI_PACKAGE_ROOT: piRoot }, stdio: "inherit" },
			);
			if (res.status !== 0) {
				console.error(`[fixture ${version}] check-upstream FAILED (exit ${res.status})`);
				failed = true;
			} else {
				console.error(`[fixture ${version}] check-upstream PASSED`);
			}
		}
	} catch (err) {
		console.error(`[fixture ${version}] ERROR: ${err.message}`);
		failed = true;
	}
}
process.exit(failed ? 1 : 0);
