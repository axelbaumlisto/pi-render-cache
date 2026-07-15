/**
 * render-cache — pi extension (PLAN.md Шаг 4).
 *
 * Patches Markdown.prototype.render (incremental streaming render, src/md-cache.js)
 * and Intl.Segmenter.prototype.segment (ICU memoization, src/seg-cache.js).
 *
 * - pi-tui via BARE specifier only: jiti aliases it to pi's own copy → same
 *   prototype pi renders with (ROUND2_review_2.md §1). NEVER a plugin dep.
 * - Version drift: md-cache stores hash(orig render.toString()) at first install.
 *   If shared state exists but prototype.render is neither ours nor the stored
 *   original → a foreign wrapper/new pi landed mid-process → skip install.
 * - Self-check is EVENT-GATED (§4): armed on the FIRST message_update (a quiet
 *   session legitimately renders zero Markdown — never disable before that);
 *   2s later, zero md-cache activity → uninstall both + notify.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Markdown } from "@earendil-works/pi-tui";
import {
	getStats as mdStats,
	install as installMd,
	uninstall as uninstallMd,
} from "../src/md-cache.js";
import {
	getStats as segStats,
	install as installSeg,
	uninstall as uninstallSeg,
} from "../src/seg-cache.js";

const MD_STATE_KEY = Symbol.for("render-cache:md:v1");
const SELF_CHECK_MS = 2000;

/** djb2 → hex; must mirror md-cache.js hashString (drift check compares against its origHash). */
function hashString(str: string): string {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
	return h.toString(16);
}

export default function (pi: ExtensionAPI) {
	// Version-drift guard BEFORE install: existing state whose patch is no longer
	// on the prototype AND the current render doesn't hash to the stored original
	// → someone replaced render mid-process; stitching against it would be unsound.
	const state = (globalThis as Record<symbol, any>)[MD_STATE_KEY];
	const current = Markdown.prototype.render;
	if (state && current !== state.patched && hashString(current.toString()) !== state.origHash) {
		pi.on("session_start", (_event, ctx) => {
			ctx.ui.notify("render-cache: Markdown.render version drift detected, not installing", "warning");
		});
		return;
	}

	installSeg();
	installMd({ Markdown, getCapabilities, budgetChars: 2_000_000 });

	// Self-check: armed once, on the first message_update only.
	let armed = false;
	pi.on("message_update", (_event, ctx) => {
		if (armed) return;
		armed = true;
		const timer = setTimeout(() => {
			const s = mdStats();
			if (s.hits + s.misses + s.fallbacks === 0) {
				uninstallMd();
				uninstallSeg();
				ctx.ui.notify("render-cache: patch inactive, self-disabled", "warning");
			}
		}, SELF_CHECK_MS);
		timer.unref?.();
	});

	pi.registerCommand("rcstats", {
		description: "render-cache hit/miss/fallback stats",
		handler: async (_args, ctx) => {
			const m = mdStats();
			const g = segStats();
			ctx.ui.notify(
				`md h${m.hits}/m${m.misses}/f${m.fallbacks} size ${m.size} chars ${m.chars} | ` +
					`seg h${g.hits}/m${g.misses}/f${g.fallbacks}`,
				"info",
			);
		},
	});
}
