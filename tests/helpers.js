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
