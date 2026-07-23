/**
 * Test helpers: load pi-tui and pi theme module directly from the pi installation.
 * pi-tui is NEVER a dependency of this plugin (same-registry guarantee, see PLAN.md).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve peer dev dependencies from the current installation. Never hardcode
// a developer machine path: tests must work in clones, CI, and Pi's package dir.
const PI_TUI_PATH = fileURLToPath(import.meta.resolve("@earendil-works/pi-tui"));
const PI_AGENT_ENTRY = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const PI_AGENT_DIST = dirname(PI_AGENT_ENTRY);
const THEME_PATH = join(PI_AGENT_DIST, "modes/interactive/theme/theme.js");

/** @returns {Promise<object>} pi-tui module namespace (Markdown, getCapabilities, ...) */
export async function loadPiTui() {
	return import(PI_TUI_PATH);
}

/**
 * Load pi's theme module and ensure the global theme is initialized.
 * NOTE: `setGlobalTheme` is private in theme.js (only `initTheme`/`setThemeInstance`
 * are exported), so we provide a shim writing the same globalThis symbols.
 * @returns {Promise<{getMarkdownTheme: () => object, setGlobalTheme: (t: object) => void, theme: object, initTheme: Function, setThemeInstance: Function}>}
 */
export async function loadTheme() {
	const mod = await import(THEME_PATH);
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
