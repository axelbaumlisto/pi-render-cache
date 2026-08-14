/**
 * render-cache — pi extension (thin wiring layer, plan Task 2).
 *
 * Patches Markdown.prototype.render (incremental streaming render, src/md-cache.js)
 * and Intl.Segmenter.prototype.segment (ICU memoization, src/seg-cache.js).
 *
 * All decision/transition logic lives in src/patch-state.js so tests can drive
 * the real code without a pi host. Per-patch lifecycle:
 *   - md-cache installs when djb2(Markdown.prototype.render.toString()) matches
 *     any known-good hash in compatibility.json; unknown implementation hashes
 *     → "unsupported", never patched.
 *   - seg-cache is evaluated INDEPENDENTLY (descriptor writable+configurable
 *     plus a native-behavior canary); one patch's failure never affects the other.
 *   - Shared state on globalThis symbols lets /reload adopt; a foreign function
 *     where ours/original should be → "ownership-lost", never layer, never
 *     restore, restart required.
 * Counters are observability only — there is NO zero-activity self-disable.
 *
 * pi-tui via BARE specifier only: jiti aliases it to pi's own copy → same
 * prototype pi renders with. NEVER a plugin dep.
 */
import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Markdown } from "@earendil-works/pi-tui";
import { getStats as mdStats } from "../src/md-cache.js";
import {
	mdOwnership,
	segOwnership,
	selectMarkdownAllowlistHashes,
	setupMd,
	setupSeg,
	summary,
} from "../src/patch-state.js";
import { getStats as segStats } from "../src/seg-cache.js";
import { resolvePiRoot, resolvePiTui } from "../scripts/resolve-pi.mjs";

/** Allowlisted Markdown.render hashes for every known-good implementation. */
function loadAllowlistHashes(): string[] {
	try {
		const url = new URL("../compatibility.json", import.meta.url);
		const compat = JSON.parse(fs.readFileSync(url, "utf8"));
		return selectMarkdownAllowlistHashes(compat);
	} catch {
		return []; // unreadable/missing compatibility data → md unsupported
	}
}

export default function (pi: ExtensionAPI) {
	// Evaluate each patch INDEPENDENTLY; failures never cross over.
	const md = setupMd({
		Markdown,
		getCapabilities,
		allowlistHashes: loadAllowlistHashes(),
		budgetChars: 2_000_000,
	});
	const seg = setupSeg({ budgetChars: 2_000_000 });

	// Notify only when something is NOT active, with per-patch reason.
	if (md.state !== "active" || seg.state !== "active") {
		pi.on("session_start", (_event, ctx) => {
			const parts: string[] = [];
			if (md.state !== "active") parts.push(`md-cache ${md.state}: ${md.reason ?? "n/a"}`);
			if (seg.state !== "active") parts.push(`seg-cache ${seg.state}: ${seg.reason ?? "n/a"}`);
			ctx.ui.notify(`render-cache: ${parts.join(" | ")}`, "warning");
		});
	}

	pi.registerCommand("rcstats", {
		description: "render-cache per-patch state, ownership, versions, counters, memory",
		handler: async (_args, ctx) => {
			const s = summary();
			const m = mdStats();
			const g = segStats();
			const fmt = (p: { state: string; reason: string | null }) =>
				p.state + (p.reason ? ` (${p.reason})` : "");
			let versions = "pi ?/pi-tui ?";
			try {
				// Light ESM import of the shared resolver (shipped in scripts/).
				const rp = await import("../scripts/resolve-pi.mjs");
				const piInfo = rp.resolvePiRoot();
				const tuiInfo = rp.resolvePiTui(piInfo.root);
				versions = `pi ${piInfo.version}/pi-tui ${tuiInfo.version}`;
			} catch {
				// resolver unavailable (unusual install layout) → versions stay unknown
			}
			ctx.ui.notify(
				`md ${fmt(s.md)} own=${mdOwnership(Markdown)} h${m.hits}/m${m.misses}/f${m.fallbacks} size ${m.size} chars ${m.chars} | ` +
					`seg ${fmt(s.seg)} own=${segOwnership()} h${g.hits}/m${g.misses}/f${g.fallbacks} size ${g.size} chars ${g.chars} | ` +
					versions,
				"info",
			);
		},
	});
}
