/**
 * D2: patcher for Markdown.prototype.render — incremental streaming render.
 *
 * splitSettled(text) → {settled, tail}: the settled prefix is rendered ONCE
 * (via the ORIGINAL render on a scratch instance) and served from a global
 * budget cache; only the growing tail is re-rendered per frame. Any doubt at
 * any point → orig.call(this, width) (correct by construction, PLAN.md I1/I6).
 *
 * Cache key: length-framed settled/width/padding/signature/fingerprint/capabilities.
 * - Theme acceptance is CONTRACTUAL, not source-hash based (v1.2.0): the theme
 *   must expose exactly the MarkdownTheme callback surface (shape gate), every
 *   probe must be deterministic across repeated calls (fingerprint gate), and
 *   stitched output is self-verified against the original renderer on sampled
 *   cache fills (miss-time differential). A failing self-verification
 *   permanently blacklists the theme object and falls back to the original
 *   renderer. Deliberately spoofed callbacks that pass all probes yet render
 *   differently are unsupported-by-design and caught by the sampled
 *   differential at the first verified fill.
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

// The exact MarkdownTheme callback surface consumed by supported renderers.
// A theme must expose exactly these own keys (plus optionally codeBlockIndent)
// to be cacheable; anything else falls back to the original renderer.
export const CORE_THEME_KEYS = Object.freeze(
	[
		"bold",
		"code",
		"codeBlock",
		"codeBlockBorder",
		"heading",
		"highlightCode",
		"hr",
		"italic",
		"link",
		"linkUrl",
		"listBullet",
		"quote",
		"quoteBorder",
		"strikethrough",
		"underline",
	].sort(),
);

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
 * Validate the exact supported own-key SHAPE contract (no source hashing —
 * v1.2.0 removed the locked-source allowlist). Reading own keys/properties can
 * trigger Proxy traps; callbacks are never invoked here. Behavioral safety for
 * accepted shapes comes from the per-render output fingerprint (determinism
 * double-probe) plus the sampled miss-time differential self-verification.
 * Returns a compact identity for the accepted raw/wrapped shape.
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
	for (const key of CORE_THEME_KEYS) {
		if (typeof theme[key] !== "function") return null;
	}
	const signatureHash = hashString(frameParts(["shape-v2", ...keys, hasIndent ? "indent" : ""]));
	THEME_SIGNATURE_CACHE.set(theme, signatureHash);
	return signatureHash;
}

/** Element-wise strict equality of two string arrays. */
function linesEqual(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
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
		// Syntax palette probes. highlightCode falls back to a single flat
		// mdCodeBlock color whenever supportsLanguage(lang) is false, so a probe
		// language the host's highlighter does not recognize observes NOTHING:
		// pi 1.0.0 dropped llvm, and the former single llvm probe stopped seeing
		// every syntax color, leaving code blocks cached across a /theme switch.
		// These five recognized languages together observe comment, keyword,
		// function, variable, string, number, type and operator.
		// `punctuation` has no reachable highlight.js scope in this host, so it
		// cannot appear in rendered output either.
		["highlightCode", ['// c\nclass K { m(p: number): string { return "s" + f(p ?? 1); } }', "typescript"], true],
		["highlightCode", ['<!-- c --><div class="x" id=\'y\'>t</div>', "html"], true],
		["highlightCode", ["SELECT a + 1 FROM t WHERE id = 42;", "sql"], true],
		["highlightCode", ['# c\ndef f(x=1):\n    return "s" % x', "python"], true],
		["highlightCode", ['func f(a: Int) -> Int { let s = "x"; return a + 1 }', "swift"], true],
	];
	const components = [];
	let total = 0;
	for (const [name, args, arrayExpected = false] of probes) {
		const first = normalizeThemeOutput(theme[name](...args), arrayExpected);
		const second = normalizeThemeOutput(theme[name](...args), arrayExpected);
		if (first === null || second === null || first !== second || first.length > MAX_THEME_COMPONENT_CHARS) {
			return null;
		}
		const label = name === "highlightCode" ? `${name}:${args[1]}` : name;
		total += label.length + first.length;
		if (total > MAX_THEME_FINGERPRINT_CHARS) return null;
		components.push(label, first);
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

// Miss-time differential sampling: verify the first fills and then every
// VERIFY_SAMPLE_EVERY-th fill against a full original render. Cheap relative
// to the miss itself and catches renderer/theme drift without any allowlist.
const VERIFY_FIRST_FILLS = 2;
const VERIFY_SAMPLE_EVERY = 32;

function makePatchedRender(state) {
	const { orig, cache, counters, Markdown, getCaps, blacklist } = state;
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
		// (b2) Theme failed a previous differential self-verification → orig forever.
		if (this.theme !== null && typeof this.theme === "object" && blacklist.has(this.theme)) {
			counters.fallbacks++;
			return orig.call(this, width);
		}

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
		const isFill = prefixLines === undefined;
		if (isFill) {
			counters.misses++;
			prefixLines = orig.call(new Markdown(settled, this.paddingX, 0, this.theme), width);
		} else {
			counters.hits++;
		}

		// (f) Tail lines: original render on a scratch tail instance. The tail
		// keeps the whole blank run, so its leading space token re-emits the
		// inter-block "" separator line (seam contract, split.js).
		const tailLines = orig.call(new Markdown(tail, this.paddingX, 0, this.theme), width);

		// (g) ALWAYS a fresh array — never hand out the globally cached one.
		const stitched = prefixLines.concat(tailLines);

		// (e2) Sampled miss-time differential self-verification (v1.2.0): compare
		// the stitched result against a full original render on the first fills
		// and periodically afterwards. Mismatch → permanently blacklist the theme
		// object, do not cache, and return the (correct-by-definition) original.
		if (isFill) {
			const n = ++state.fillCount;
			if (n <= VERIFY_FIRST_FILLS || n % VERIFY_SAMPLE_EVERY === 0) {
				const full = orig.call(this, width);
				if (!linesEqual(full, stitched)) {
					blacklist.add(this.theme);
					state.verifyFailures++;
					counters.fallbacks++;
					return full; // orig already set this instance's cache coherently
				}
			}
			const retainedCost =
				settled.length + key.length + prefixLines.reduce((sum, line) => sum + line.length, 0);
			if (retainedCost <= cache.budgetChars / MAX_ENTRY_BUDGET_DIVISOR) {
				cache.set(key, prefixLines, retainedCost);
			}
		}
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
		origHash: hashString(orig.toString()), // diagnostics only; activation is behavioral (canaryVerify + self-verification)
		cache: makeBudgetCache(budgetChars * COST_UNIT_SCALE),
		counters: makeCounters(),
		Markdown,
		getCaps: getCapabilities ?? (() => ({ hyperlinks: false })),
		blacklist: new WeakSet(), // theme objects that failed differential self-verification
		fillCount: 0,
		verifyFailures: 0,
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

// Representative canary corpus: each doc has at least one safe settled
// boundary so the stitch path (not just fallback) is exercised, and together
// they cover headings, inline styles, lists, fences, quotes, rules, tables,
// links, and non-ASCII text.
const CANARY_DOCS = Object.freeze([
	"# Heading\n\nParagraph with **bold**, *italic*, `code`, and a [link](https://example.com).\n\nSecond paragraph follows here.\n",
	"First block paragraph.\n\n- list item one\n- list item two\n\n1. ordered one\n2. ordered two\n\nClosing paragraph.\n",
	"Intro paragraph.\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n\nAfter the fence with `inline code`.\n",
	"> quoted line\n> second quoted line\n\nParagraph after quote.\n\n---\n\nParagraph after rule.\n",
	"Unicode: русский текст, 日本語, emoji 🚀🎉.\n\nSecond paragraph with héllo wörld and e\u0301 combining.\n\nThird block wraps at narrow widths too.\n",
	"| col a | col b |\n| --- | ---: |\n| 1 | 2 |\n\nParagraph after the table block.\n",
]);
const CANARY_WIDTHS = Object.freeze([40, 80]);

/**
 * Behavioral differential canary (v1.2.0) — replaces the implementation-hash
 * allowlist. Temporarily installs the patch on the REAL prototypes, renders a
 * representative corpus through both the pristine original and the patched
 * path (miss pass + hit pass), requires byte equality everywhere AND actual
 * cache activity (a renderer/theme where every doc falls back is reported as
 * unsupported — the patch would be pure overhead). Always uninstalls.
 * @param {{Markdown: Function, getCapabilities?: () => {hyperlinks: boolean}, theme: object}} deps
 * @returns {{ok: boolean, reason?: string}}
 */
export function canaryVerify({ Markdown, getCapabilities, theme }) {
	if (theme === null || typeof theme !== "object") {
		return { ok: false, reason: "markdown theme unavailable for differential canary" };
	}
	if (globalThis[STATE_KEY]) {
		return { ok: false, reason: "canary refused: md-cache state already present" };
	}
	const res = install({ Markdown, getCapabilities });
	if (!res.installed) return { ok: false, reason: res.reason ?? "canary install refused" };
	const state = globalThis[STATE_KEY];
	try {
		for (let i = 0; i < CANARY_DOCS.length; i++) {
			const text = CANARY_DOCS[i];
			for (const width of CANARY_WIDTHS) {
				const expected = state.orig.call(new Markdown(text, 1, 0, theme), width);
				for (let pass = 0; pass < 2; pass++) {
					const actual = new Markdown(text, 1, 0, theme).render(width);
					if (!linesEqual(expected, actual)) {
						return {
							ok: false,
							reason: `differential canary mismatch (doc ${i}, width ${width}, pass ${pass})`,
						};
					}
				}
			}
		}
		if (state.verifyFailures > 0) {
			return {
				ok: false,
				reason: "differential canary: stitched output diverged from the original render (self-verification)",
			};
		}
		const { hits, misses } = state.counters;
		if (misses === 0 || hits === 0) {
			return {
				ok: false,
				reason: `differential canary produced no cache activity (hits ${hits}, misses ${misses}) — renderer or theme contract unsupported`,
			};
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: `differential canary threw: ${err}` };
	} finally {
		uninstall();
	}
}

/** chars is estimated retained cost; public stats shape is unchanged. */
export function getStats() {
	const state = globalThis[STATE_KEY];
	if (!state) return { hits: 0, misses: 0, fallbacks: 0, chars: 0, size: 0 };
	const { hits, misses, fallbacks } = state.counters;
	return { hits, misses, fallbacks, chars: state.cache.chars, size: state.cache.size };
}
