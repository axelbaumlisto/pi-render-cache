/**
 * D2: patcher for Markdown.prototype.render — incremental streaming render.
 *
 * splitSettled(text) → {settled, tail}: the settled prefix is rendered ONCE
 * (via the ORIGINAL render on a scratch instance) and served from a global
 * budget cache; only the growing tail is re-rendered per frame. Any doubt at
 * any point → orig.call(this, width) (correct by construction, PLAN.md I1/I6).
 *
 * Cache key: settled + width + paddingX + themeFingerprint + hyperlinksBit.
 * - themeFingerprint is computed EVERY patched render: pi's theme is a proxy
 *   over globalThis — /theme switching changes output for the SAME theme
 *   object, so identity keying would serve stale ANSI (ROUND2_review_2.md §2).
 * - paddingX is a key component, NOT a fallback (hot path always paddingX=1).
 *
 * Module is import-free of pi-tui: the Markdown class and getCapabilities are
 * passed into install() (extension/tests provide them). Shared state lives on
 * globalThis[Symbol.for("render-cache:md:v1")] so /reload (fresh module scope)
 * adopts, never layers or resets. See PLAN.md Шаг 3 + I3.
 */
import { splitSettled } from "./split.js";
import { makeBudgetCache, makeCounters } from "./stats.js";

const STATE_KEY = Symbol.for("render-cache:md:v1");

/** djb2 hash → hex string; used for version-drift detection of the original render. */
function hashString(str) {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
	return h.toString(16);
}

/**
 * Short raw-ANSI probe of the theme functions that dominate markdown output.
 * Cheap (O(µs)), and changes whenever the global theme behind pi's proxy does.
 */
function themeFingerprint(theme) {
	return (
		theme.heading("x") +
		theme.code("x") +
		theme.listBullet("x") +
		theme.quote("x") +
		String(theme.codeBlockIndent ?? "")
	);
}

/**
 * Settled ending in an indented code block is unsafe: lexed standalone, the
 * code token keeps its trailing \n (extra styled empty line); in the full doc
 * the following space token absorbs it. Cheap guard: last settled line starts
 * with ≥4 spaces after tab expansion → fallback (found by the fuzz gate).
 */
function endsWithIndentedCode(settled) {
	const lastNl = settled.lastIndexOf("\n", settled.length - 2);
	const lastLine = settled.slice(lastNl + 1).replace(/\t/g, "   ");
	return /^ {4}/.test(lastLine);
}

function makePatchedRender(state) {
	const { orig, cache, counters, Markdown, getCaps } = state;
	return function render(width) {
		// (a) Preserve the original O(1) per-instance second-call path
		// (Container/overlay call render twice per frame).
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
			return this.cachedLines;
		}
		// (b) Non-cacheable configurations → orig entirely.
		if (
			typeof this.text !== "string" ||
			this.paddingY > 0 ||
			this.defaultTextStyle != null ||
			(this.options != null && Object.keys(this.options).length > 0)
		) {
			counters.fallbacks++;
			return orig.call(this, width);
		}
		// (g-pre) Empty/whitespace text: orig handles []-semantics + instance cache.
		if (!this.text || this.text.trim() === "") return orig.call(this, width);

		let key;
		let settled;
		let tail;
		try {
			// (c) Conservative split; hazards → settled "" → orig path entirely.
			({ settled, tail } = splitSettled(this.text));
			if (settled === "" || endsWithIndentedCode(settled)) {
				counters.fallbacks++;
				return orig.call(this, width);
			}
			// (d) Cache key. themeFingerprint every render (proxy theme, see header).
			const hyperlinksBit = getCaps().hyperlinks ? "1" : "0";
			key =
				settled +
				"\0" +
				width +
				"\0" +
				this.paddingX +
				"\0" +
				themeFingerprint(this.theme) +
				"\0" +
				hyperlinksBit;
		} catch {
			// Exotic theme/capabilities/text → any doubt means orig.
			counters.fallbacks++;
			return orig.call(this, width);
		}

		// (e) Prefix lines: global cache, or one original render on a scratch
		// instance (same paddingX/theme, no paddingY/style/options).
		let prefixLines = cache.get(key);
		if (prefixLines === undefined) {
			counters.misses++;
			prefixLines = orig.call(new Markdown(settled, this.paddingX, 0, this.theme), width);
			cache.set(key, prefixLines, settled.length);
		} else {
			counters.hits++;
		}

		// (f) Tail lines: original render on a scratch tail instance. The tail
		// keeps the whole blank run, so its leading space token re-emits the
		// inter-block "" separator line (seam contract, split.js).
		const tailLines = orig.call(new Markdown(tail, this.paddingX, 0, this.theme), width);

		// (g) ALWAYS a fresh array — never hand out the globally cached one.
		const stitched = prefixLines.concat(tailLines);
		const result = stitched.length > 0 ? stitched : [""];
		// (h) Per-instance cache coherence (second same-frame call → O(1) path).
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;
		return result;
	};
}

/**
 * Idempotent install; adopts existing shared state on reinstall (/reload-safe).
 * @param {{Markdown: Function, getCapabilities?: () => {hyperlinks: boolean}, budgetChars?: number}} deps
 */
export function install({ Markdown, getCapabilities, budgetChars = 2_000_000 }) {
	const existing = globalThis[STATE_KEY];
	if (existing) return; // adopt: state (counters, cache, patch) already live
	const orig = Markdown.prototype.render;
	const state = {
		orig,
		origHash: hashString(orig.toString()), // version-drift guard (checked by the extension)
		cache: makeBudgetCache(budgetChars),
		counters: makeCounters(),
		Markdown,
		getCaps: getCapabilities ?? (() => ({ hyperlinks: false })),
		patched: null,
	};
	state.patched = makePatchedRender(state);
	globalThis[STATE_KEY] = state;
	Markdown.prototype.render = state.patched;
}

/** Restores the original ONLY if prototype.render is still ours (monkey-patch etiquette). */
export function uninstall() {
	const state = globalThis[STATE_KEY];
	if (!state) return;
	if (state.Markdown.prototype.render === state.patched) {
		state.Markdown.prototype.render = state.orig;
	}
	delete globalThis[STATE_KEY];
}

/** @returns {{hits: number, misses: number, fallbacks: number, chars: number, size: number}} */
export function getStats() {
	const state = globalThis[STATE_KEY];
	if (!state) return { hits: 0, misses: 0, fallbacks: 0, chars: 0, size: 0 };
	const { hits, misses, fallbacks } = state.counters;
	return { hits, misses, fallbacks, chars: state.cache.chars, size: state.cache.size };
}
