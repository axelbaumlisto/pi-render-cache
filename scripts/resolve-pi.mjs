/**
 * Single shared resolver for the selected pi installation (one compatibility unit).
 *
 * Resolution order for the pi package root:
 *   1. explicit PI_PACKAGE_ROOT env override (isolated fixtures / CI matrix);
 *   2. Node resolution from THIS project root
 *      (require.resolve('@earendil-works/pi-coding-agent/package.json'));
 *   3. `pi` binary on PATH: realpath of `which pi` walked up to its package root
 *      (pi is commonly a global install, not a local dependency).
 *
 * pi-tui and the theme module are ALWAYS resolved FROM the selected pi root —
 * never independently — so runtime, tests, and diagnostics use one pi-tui copy.
 * All returned paths are canonical realpaths.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PI_PKG = "@earendil-works/pi-coding-agent";
const TUI_PKG = "@earendil-works/pi-tui";

const NOT_FOUND_HELP = [
	`Cannot locate the ${PI_PKG} package. Fix one of:`,
	"  - set PI_PACKAGE_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent",
	`  - install pi globally so \`pi\` is on PATH: npm install -g ${PI_PKG}`,
	`  - install pi locally in this project: npm install --no-save ${PI_PKG}`,
	"  - use an isolated fixture: node scripts/install-fixture.mjs <version>",
].join("\n");

/** Read and parse a package.json, returning null on any failure. */
function readPkg(dir) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	} catch {
		return null;
	}
}

/** Walk up from a file/dir until a package.json with the expected name is found. */
function findPackageRootUp(startPath, expectedName) {
	let dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
	for (;;) {
		const pkg = readPkg(dir);
		if (pkg && pkg.name === expectedName) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Resolve the selected pi package root.
 * @returns {{root: string, version: string, source: "env"|"require"|"path-binary"}}
 * @throws {Error} actionable message when pi cannot be located
 */
export function resolvePiRoot() {
	// 1. Explicit override (fixtures, CI matrix).
	const envRoot = process.env.PI_PACKAGE_ROOT;
	if (envRoot) {
		let real;
		try {
			real = fs.realpathSync(envRoot);
		} catch {
			throw new Error(`PI_PACKAGE_ROOT does not exist: ${envRoot}\n${NOT_FOUND_HELP}`);
		}
		const pkg = readPkg(real);
		if (!pkg || pkg.name !== PI_PKG) {
			throw new Error(
				`PI_PACKAGE_ROOT is not a ${PI_PKG} package root: ${real}` +
					` (found ${pkg ? `"${pkg.name}"` : "no package.json"})\n${NOT_FOUND_HELP}`,
			);
		}
		return { root: real, version: pkg.version, source: "env" };
	}

	// 2. Node resolution from this project root.
	try {
		const require = createRequire(new URL("../package.json", import.meta.url));
		const pkgJsonPath = require.resolve(`${PI_PKG}/package.json`);
		const root = fs.realpathSync(path.dirname(pkgJsonPath));
		const pkg = readPkg(root);
		if (pkg && pkg.name === PI_PKG) return { root, version: pkg.version, source: "require" };
	} catch {
		// fall through to PATH lookup
	}

	// 3. `pi` binary on PATH → realpath → walk up to the package root.
	try {
		const whichCmd = process.platform === "win32" ? "where" : "which";
		const binPath = execFileSync(whichCmd, ["pi"], { encoding: "utf8" }).split("\n")[0].trim();
		if (binPath) {
			const real = fs.realpathSync(binPath);
			const root = findPackageRootUp(real, PI_PKG);
			if (root) {
				const pkg = readPkg(root);
				return { root: fs.realpathSync(root), version: pkg.version, source: "path-binary" };
			}
		}
	} catch {
		// fall through to error
	}

	throw new Error(NOT_FOUND_HELP);
}

/**
 * Resolve pi-tui FROM the selected pi package root (never independently).
 * Prefers the physically nested copy; falls back to Node resolution from the
 * pi root (npm flat installs place pi-tui as a sibling in the same tree).
 * @param {string} piRoot canonical pi package root
 * @returns {{root: string, version: string, entry: string}} entry = realpath of the runtime module
 */
export function resolvePiTui(piRoot) {
	let tuiRoot = null;
	const nested = path.join(piRoot, "node_modules", ...TUI_PKG.split("/"));
	if (fs.existsSync(path.join(nested, "package.json"))) {
		tuiRoot = fs.realpathSync(nested);
	} else {
		try {
			const require = createRequire(path.join(piRoot, "package.json"));
			tuiRoot = fs.realpathSync(path.dirname(require.resolve(`${TUI_PKG}/package.json`)));
		} catch {
			throw new Error(
				`Cannot resolve ${TUI_PKG} from the selected pi root: ${piRoot}\n` +
					`Expected it nested at ${nested} or reachable via Node resolution from the pi root.`,
			);
		}
	}
	const pkg = readPkg(tuiRoot);
	if (!pkg || pkg.name !== TUI_PKG) {
		throw new Error(`Resolved ${tuiRoot} is not a ${TUI_PKG} package root.`);
	}
	const entry = fs.realpathSync(path.join(tuiRoot, pkg.main ?? "dist/index.js"));
	return { root: tuiRoot, version: pkg.version, entry };
}

/**
 * Resolve pi's theme module (getMarkdownTheme etc.) from the selected pi root.
 * @param {string} piRoot canonical pi package root
 * @returns {{path: string}} realpath of dist/modes/interactive/theme/theme.js
 */
export function resolveThemeModule(piRoot) {
	const themePath = path.join(piRoot, "dist", "modes", "interactive", "theme", "theme.js");
	if (!fs.existsSync(themePath)) {
		throw new Error(
			`pi theme module not found at ${themePath} — unsupported pi build/layout.\n${NOT_FOUND_HELP}`,
		);
	}
	return { path: fs.realpathSync(themePath) };
}
