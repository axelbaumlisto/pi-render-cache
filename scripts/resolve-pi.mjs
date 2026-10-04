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
import { pathToFileURL } from "node:url";

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
/**
 * pi >= 1.0.1 managed install: the `pi` on PATH is a shell launcher in
 * `<agentDir>/bin`, and the real package lives in
 * `<agentDir>/install/releases/<version>/node_modules/@earendil-works/pi-coding-agent`.
 * Walking up from the launcher therefore finds no package at all.
 *
 * `current-version` names the active release; when it is missing or stale we
 * accept a single present release rather than guessing between several.
 * @param {string} launcherPath canonical path of the `pi` on PATH
 * @returns {{root: string, version: string, source: string} | null}
 */
function resolveManagedInstall(launcherPath) {
	const agentDir = path.dirname(path.dirname(launcherPath));
	const releases = path.join(agentDir, "install", "releases");
	if (!fs.existsSync(releases)) return null;

	const candidates = [];
	try {
		const current = fs.readFileSync(path.join(agentDir, "install", "current-version"), "utf8").trim();
		if (current) candidates.push(current);
	} catch {
		/* no current-version file — fall back to a sole release below */
	}
	if (candidates.length === 0) {
		let entries = [];
		try {
			entries = fs.readdirSync(releases);
		} catch {
			return null;
		}
		if (entries.length !== 1) return null;
		candidates.push(entries[0]);
	}

	for (const version of candidates) {
		const root = path.join(releases, version, "node_modules", ...PI_PKG.split("/"));
		const pkg = readPkg(root);
		if (pkg && pkg.name === PI_PKG) {
			return { root: fs.realpathSync(root), version: pkg.version, source: "managed-install" };
		}
	}
	return null;
}

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

	// 3. `pi` binary on PATH → realpath → walk up to the package root, or read
	//    the managed install it launches.
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
			const managed = resolveManagedInstall(real);
			if (managed) return managed;
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

/**
 * The module pi's renderer actually runs from.
 *
 * Since pi 0.84.3 the TUI is inlined into pi's own bundle, so the installed
 * `@earendil-works/pi-tui` package is a copy nobody loads — patching it has no
 * effect on a live session (measured: 0 calls through the package, 50 through
 * the bundle). Node keys the ESM cache by resolved path, so importing the chunk
 * by its absolute path hands back the very module object pi is using.
 *
 * Chunk names are content-hashed and change every release, so the chunk is
 * found by what it exports, never by name. Returns null when the layout has no
 * bundle (pi <= 0.84.2), where the package IS the live module.
 */
export async function resolveLiveTuiModule(piRoot) {
	const chunkDir = path.join(piRoot, "dist", "bundle", "chunks");
	if (!fs.existsSync(chunkDir)) return null;

	for (const file of fs.readdirSync(chunkDir)) {
		if (!file.endsWith(".js")) continue;
		let mod;
		try {
			mod = await import(pathToFileURL(path.join(chunkDir, file)).href);
		} catch {
			continue; // a chunk that cannot stand alone is not the renderer
		}
		if (typeof mod?.Markdown?.prototype?.render === "function" && typeof mod?.getCapabilities === "function") {
			return { module: mod, path: path.join(chunkDir, file) };
		}
	}
	return null;
}
