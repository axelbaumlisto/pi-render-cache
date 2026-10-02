/**
 * Test helpers: load pi-tui and pi theme module directly from the pi installation.
 * pi-tui is NEVER a dependency of this plugin (same-registry guarantee, see PLAN.md).
 */

import { pathToFileURL } from "node:url";
import { resolvePiRoot, resolvePiTui, resolveThemeModule } from "../scripts/resolve-pi.mjs";

const PI_ROOT = resolvePiRoot().root;
const PI_TUI_PATH = resolvePiTui(PI_ROOT).entry;
const THEME_PATH = resolveThemeModule(PI_ROOT).path;

/** @returns {Promise<object>} pi-tui module namespace (Markdown, getCapabilities, ...) */
export async function loadPiTui() {
	return import(pathToFileURL(PI_TUI_PATH).href);
}

/**
 * Load pi's theme module and ensure the global theme is initialized.
 * NOTE: `setGlobalTheme` is private in theme.js (only `initTheme`/`setThemeInstance`
 * are exported), so we provide a shim writing the same globalThis symbols.
 * @returns {Promise<{getMarkdownTheme: () => object, setGlobalTheme: (t: object) => void, theme: object, initTheme: Function, setThemeInstance: Function}>}
 */
export async function loadTheme() {
	const mod = await import(pathToFileURL(THEME_PATH).href);
	// theme is a proxy over globalThis; getMarkdownTheme() throws until initialized.
	const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
	const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");
	const setGlobalTheme = (t) => {
		globalThis[THEME_KEY] = t;
		globalThis[THEME_KEY_OLD] = t;
	};
	if (!globalThis[THEME_KEY]) {
		mod.initTheme("dark");
	}
	return {
		getMarkdownTheme: mod.getMarkdownTheme,
		setGlobalTheme,
		theme: mod.theme,
		initTheme: mod.initTheme,
		setThemeInstance: mod.setThemeInstance,
	};
}

/**
 * Clone the live Theme instance with ONE recolored token.
 *
 * Where a token's ANSI lives moved upstream: pi <= 0.84 derived it from the raw
 * `fgColors` map on every `fg()` call, pi >= 1.0 precomputes `fgAnsi` (and
 * `concreteColors` for syntax highlighting) in the Theme constructor. Tests that
 * only rewrote `fgColors` silently became no-ops on 1.0.0 — the theme-switch
 * assertions then failed on their own sanity check, not on the cache.
 *
 * Writing every representation that exists on the instance keeps the recolor
 * effective on both shapes.
 *
 * @param {object} saved live theme instance
 * @param {string} token e.g. "mdHeading", "syntaxKeyword"
 * @param {string} color color source value, e.g. "#ff00ff"
 * @param {string} ansi matching SGR sequence, e.g. "\x1b[38;2;255;0;255m"
 */
export function cloneThemeWithToken(saved, token, color, ansi) {
	const alt = Object.assign(Object.create(Object.getPrototypeOf(saved)), saved);
	if (saved.fgColors instanceof Map) {
		alt.fgColors = new Map(saved.fgColors);
		alt.fgColors.set(token, ansi);
	} else if (saved.fgColors && typeof saved.fgColors === "object") {
		alt.fgColors = { ...saved.fgColors, [token]: color };
	}
	if (saved.fgAnsi instanceof Map) {
		alt.fgAnsi = new Map(saved.fgAnsi);
		alt.fgAnsi.set(token, ansi);
	}
	if (saved.concreteColors && typeof saved.concreteColors === "object") {
		alt.concreteColors = { ...saved.concreteColors, [token]: parseAnsiTruecolor(ansi) ?? saved.concreteColors[token] };
	}
	return alt;
}

function parseAnsiTruecolor(ansi) {
	const match = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(ansi);
	return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null;
}
