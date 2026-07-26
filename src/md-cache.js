/**
 * D2: patcher for Markdown.prototype.render — incremental streaming render.
 *
 * splitSettled(text) → {settled, tail}: the settled prefix is rendered ONCE
 * (via the ORIGINAL render on a scratch instance) and served from a global
 * budget cache; only the growing tail is re-rendered per frame. Any doubt at
 * any point → orig.call(this, width) (correct by construction, PLAN.md I1/I6).
 *
 * Cache key: length-framed settled/width/padding/signature/fingerprint/capabilities.
 * - Theme source signatures are compatibility gates, NOT authentication. A
 *   matching theme contract requires deterministic, side-effect-free,
 *   input-transparent callbacks. Deliberately spoofed/stateful callbacks are
 *   unsupported; ordinary non-matching themes reach original render without
 *   any analysis callback invocation.
 * - The bounded output fingerprint is computed EVERY patched render after the
 *   signature gate: pi's functions close over a global theme proxy, so /theme
 *   switching changes output without changing function identity or source.
 * - paddingX is a key component, NOT a fallback (hot path always paddingX=1).
 *
 * Budget cost units are conservative retained-cost estimates, not source chars.
 * The effective default is 8,000,000 units (≈7,813 KiB of estimated retention,
 * not a heap-byte guarantee). Legacy budgetChars inputs are scaled by 4 so the
 * extension's existing 2,000,000 setting receives that effective default.
 *
 * Module is import-free of pi-tui: the Markdown class and getCapabilities are
 * passed into install() (extension/tests provide them). Shared state lives on
 * globalThis[Symbol.for("render-cache:md:v1")] so /reload (fresh module scope)
 * adopts, never layers or resets. See PLAN.md Шаг 3 + I3.
 */
import { splitSettled } from "./split.js";
import { makeBudgetCache, makeCounters } from "./stats.js";

const STATE_KEY = Symbol.for("render-cache:md:v1");
const MAX_THEME_COMPONENT_CHARS = 2048;
const MAX_THEME_FINGERPRINT_CHARS = 32 * 1024;
const MAX_ENTRY_BUDGET_DIVISOR = 4;
const LEGACY_BUDGET_CHARS_DEFAULT = 2_000_000;
const COST_UNIT_SCALE = 4;
const THEME_SIGNATURE_CACHE = new WeakMap();

// Task 4 calibration: observed retained-cost/source-char ratios were ~8–9×
// for md entries. A 4× legacy-input scale restores substantial capacity while
// keeping the conservative hard bound; Tasks 6/7 may later pass calibrated
// values directly after revisiting this compatibility contract.

// Locked getMarkdownTheme() callback sources for pi 0.80.7 and 0.82.1.
// Keep this table synchronized with compatibility.json.markdownThemeSignature.
export const CORE_THEME_SOURCE_HASHES = Object.freeze({
	bold: "43793f0e",
	code: "433573d6",
	codeBlock: "764046a1",
	codeBlockBorder: "544bbfdf",
	heading: "2b6ea36b",
	highlightCode: "d579802b",
	hr: "207f1df5",
	italic: "c12ab783",
	link: "beebce09",
	linkUrl: "ef629a9c",
	listBullet: "31da633f",
	quote: "3932d489",
	quoteBorder: "9afb1bc7",
	strikethrough: "e75a5770",
	underline: "8d0df633",
});
const CORE_THEME_KEYS = Object.freeze(Object.keys(CORE_THEME_SOURCE_HASHES).sort());

/** djb2 hash → hex string; used for compact compatibility/cache identities. */
export function hashString(str) {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
	return h.toString(16);
}

/** Length-frame arbitrary string parts; embedded NULs cannot collide. */
function frameParts(parts) {
	return parts.map((part) => `${part.length}\0${part}`).join("\0");
}

/**
 * Validate the exact supported own-key shape and locked callback sources.
 * Reading own keys/properties can trigger Proxy traps; callbacks are never
 * invoked here. Returns a compact identity for the accepted raw/wrapped shape.
 */
function themeSignature(theme) {
	const memoized = THEME_SIGNATURE_CACHE.get(theme);
	if (memoized !== undefined) return memoized;

	const keys = Reflect.ownKeys(theme);
	if (keys.some((key) => typeof key !== "string")) return null;
	keys.sort();
	const hasIndent = keys.includes("codeBlockIndent");
	const expectedKeys = hasIndent ? [...CORE_THEME_KEYS, "codeBlockIndent"].sort() : CORE_THEME_KEYS;
	if (keys.length !== expectedKeys.length || keys.some((key, i) => key !== expectedKeys[i])) return null;
	if (hasIndent && typeof theme.codeBlockIndent !== "string") return null;

	const signatureParts = [];
	for (const key of CORE_THEME_KEYS) {
		const callback = theme[key];
		if (typeof callback !== "function") return null;
		const sourceHash = hashString(Function.prototype.toString.call(callback));
		if (sourceHash !== CORE_THEME_SOURCE_HASHES[key]) return null;
		signatureParts.push(key, sourceHash);
	}
	if (hasIndent) signatureParts.push("codeBlockIndent", "string");
	const signatureHash = hashString(frameParts(signatureParts));
	THEME_SIGNATURE_CACHE.set(theme, signatureHash);
	return signatureHash;
}

function normalizeThemeOutput(value, arrayExpected = false) {
	if (!arrayExpected) return typeof value === "string" ? value : null;
	if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) return null;
	return frameParts(value);
}

/**
 * Complete bounded output fingerprint for fields consumed by Markdown.render.
 * Every probe is repeated; throws, mismatches, or oversized work reject the
 * cache path. This runs only after source-signature compatibility succeeds.
 */
function themeFingerprint(theme) {
	const probes = [
		["heading", ["H"]],
		["link", ["L"]],
		["linkUrl", ["https://x"]],
		["code", ["c"]],
		["codeBlock", ["b"]],
		["codeBlockBorder", ["|"]],
		["quote", ["q"]],
		["quoteBorder", [">"]],
		["hr", ["-"]],
		["listBullet", ["*"]],
		["bold", ["b"]],
		["italic", ["i"]],
		["underline", ["u"]],
		["strikethrough", ["s"]],
		// This recognized LLVM probe empirically exercises every palette mapping
		// consumed by getCliHighlightTheme: comment, keyword, function, variable,
		// string, number, type, operator, and punctuation.
		[
			"highlightCode",
			[
				';c\ndefine i8 @f(i8 %x){%v=add i8 %x,1}\n@x=c"s"',
				"llvm",
			],
			true,
		],
	];
	const components = [];
	let total = 0;
	for (const [name, args, arrayExpected = false] of probes) {
		const first = normalizeThemeOutput(theme[name](...args), arrayExpected);
		const second = normalizeThemeOutput(theme[name](...args), arrayExpected);
		if (first === null || second === null || first !== second || first.length > MAX_THEME_COMPONENT_CHARS) {
			return null;
		}
		total += name.length + first.length;
		if (total > MAX_THEME_FINGERPRINT_CHARS) return null;
		components.push(name, first);
	}
	const indent = theme.codeBlockIndent ?? "";
	if (typeof indent !== "string" || indent.length > MAX_THEME_COMPONENT_CHARS) return null;
	total += "codeBlockIndent".length + indent.length;
	if (total > MAX_THEME_FINGERPRINT_CHARS) return null;
	components.push("codeBlockIndent", indent);
	return hashString(frameParts(components));
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
			// (d) Gate callback compatibility before bounded output probing.
			const signatureHash = themeSignature(this.theme);
			if (signatureHash === null) {
				counters.fallbacks++;
				return orig.call(this, width);
			}
			const fingerprintHash = themeFingerprint(this.theme);
			if (fingerprintHash === null) {
				counters.fallbacks++;
				return orig.call(this, width);
			}
			const hyperlinksBit = getCaps().hyperlinks ? "1" : "0";
			key = frameParts([
				settled,
				String(width),
				String(this.paddingX),
				signatureHash,
				fingerprintHash,
				hyperlinksBit,
			]);
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
			const retainedCost =
				settled.length + key.length + prefixLines.reduce((sum, line) => sum + line.length, 0);
			if (retainedCost <= cache.budgetChars / MAX_ENTRY_BUDGET_DIVISOR) {
				cache.set(key, prefixLines, retainedCost);
			}
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
 * REFUSES TO LAYER: if shared state exists but the prototype holds a foreign
 * function (neither ours nor the pristine original), no new wrapper is added
 * and the caller gets {installed:false, reason:"ownership-lost"}.
 * @param {{Markdown: Function, getCapabilities?: () => {hyperlinks: boolean}, budgetChars?: number}} deps
 * @returns {{installed: boolean, adopted?: boolean, reason?: string}}
 */
export function install({ Markdown, getCapabilities, budgetChars = LEGACY_BUDGET_CHARS_DEFAULT }) {
	const existing = globalThis[STATE_KEY];
	if (existing) {
		const current = existing.Markdown.prototype.render;
		if (current === existing.patched) return { installed: true, adopted: true };
		if (current === existing.orig) {
			// State survived but the prototype is pristine (e.g. interrupted teardown):
			// re-applying OUR patch over the tracked original is safe, not layering.
			existing.Markdown.prototype.render = existing.patched;
			return { installed: true, adopted: true };
		}
		return { installed: false, reason: "ownership-lost" }; // never layer over a foreign fn
	}
	const orig = Markdown.prototype.render;
	const state = {
		orig,
		origHash: hashString(orig.toString()), // recorded at install for tests/diagnostics; the runtime gate is evaluateMdSupport() in patch-state.js
		cache: makeBudgetCache(budgetChars * COST_UNIT_SCALE),
		counters: makeCounters(),
		Markdown,
		getCaps: getCapabilities ?? (() => ({ hyperlinks: false })),
		patched: null,
	};
	state.patched = makePatchedRender(state);
	globalThis[STATE_KEY] = state;
	Markdown.prototype.render = state.patched;
	return { installed: true };
}

/**
 * Restores the original ONLY if prototype.render is still ours (or already the
 * original). On ownership loss (foreign wrapper on the prototype) the shared
 * state is PRESERVED — a foreign wrapper may still call our patch, and
 * dropping bookkeeping would let a later install layer a second wrapper.
 * @returns {{restored: boolean, reason?: string}}
 */
export function uninstall() {
	const state = globalThis[STATE_KEY];
	if (!state) return { restored: true }; // nothing installed → already pristine
	const current = state.Markdown.prototype.render;
	if (current === state.patched) {
		state.Markdown.prototype.render = state.orig;
		delete globalThis[STATE_KEY];
		return { restored: true };
	}
	if (current === state.orig) {
		delete globalThis[STATE_KEY]; // prototype already pristine
		return { restored: true };
	}
	return { restored: false, reason: "ownership-lost" }; // keep state; restart required
}

/** chars is estimated retained cost; public stats shape is unchanged. */
export function getStats() {
	const state = globalThis[STATE_KEY];
	if (!state) return { hits: 0, misses: 0, fallbacks: 0, chars: 0, size: 0 };
	const { hits, misses, fallbacks } = state.counters;
	return { hits, misses, fallbacks, chars: state.cache.chars, size: state.cache.size };
}
