/**
 * Patch lifecycle controller (plan Task 2). Owns per-patch state so the
 * extension is a thin wiring layer and tests can drive REAL decision +
 * transition code without a pi host.
 *
 * States per patch ("md" | "seg"):
 *   - "inactive"        not installed (initial, or after a clean uninstall)
 *   - "active"          our wrapper is on the prototype (or adopted after /reload)
 *   - "unsupported"     evaluation refused install (reason attached)
 *   - "ownership-lost"  a foreign function sits where ours/original should be;
 *                       we never layer, never restore, never drop bookkeeping
 *                       (reason attached; restart required)
 *
 * Lifecycle state lives on globalThis[Symbol.for("render-cache:lifecycle:v1")]
 * so /reload (fresh module scope) adopts it. Decisions for md-cache and
 * seg-cache are fully independent: neither evaluate/setup function reads the
 * other patch's state.
 */
import {
	canaryVerify,
	hashString,
	install as installMd,
	uninstall as uninstallMd,
} from "./md-cache.js";
import { install as installSeg, uninstall as uninstallSeg } from "./seg-cache.js";

const LIFECYCLE_KEY = Symbol.for("render-cache:lifecycle:v1");
const MD_STATE_KEY = Symbol.for("render-cache:md:v1");
const SEG_STATE_KEY = Symbol.for("render-cache:seg:v1");

function lifecycle() {
	let s = globalThis[LIFECYCLE_KEY];
	if (!s) {
		s = {
			md: { state: "inactive", reason: null },
			seg: { state: "inactive", reason: null },
		};
		globalThis[LIFECYCLE_KEY] = s;
	}
	return s;
}

/** @param {"md"|"seg"} patch @returns {{state: string, reason: string|null}} */
export function getState(patch) {
	return { ...lifecycle()[patch] };
}

/** @param {"md"|"seg"} patch @param {string} state @param {string|null} [reason] */
export function setState(patch, state, reason = null) {
	lifecycle()[patch] = { state, reason };
}

/** @returns {{md: {state: string, reason: string|null}, seg: {state: string, reason: string|null}}} */
export function summary() {
	const s = lifecycle();
	return { md: { ...s.md }, seg: { ...s.seg } };
}

/** Test helper: drop the shared lifecycle record (does NOT touch patch state). */
export function resetLifecycle() {
	delete globalThis[LIFECYCLE_KEY];
}

// ---------------------------------------------------------------------------
// Independent support evaluation (pure decisions, no side effects)
// ---------------------------------------------------------------------------

/**
 * Decide whether md-cache may install against this Markdown class.
 * v1.2.0: NO implementation-hash or pi-version allowlist — this is a purely
 * structural + ownership decision. Behavioral support is verified separately
 * by the differential canary (canaryVerify in md-cache.js) inside setupMd().
 * @param {Function} Markdown pi-tui Markdown class
 * @returns {{decision: "install"|"adopt"|"unsupported"|"ownership-lost", reason?: string, hash?: string}}
 */
export function evaluateMdSupport(Markdown) {
	const shared = globalThis[MD_STATE_KEY];
	const current = Markdown.prototype.render;
	if (shared) {
		// Previous-load state exists (e.g. /reload). Adopt only if the prototype
		// is ours or the pristine original; anything else is a foreign wrapper.
		if (current === shared.patched || current === shared.orig) {
			return { decision: "adopt" };
		}
		return {
			decision: "ownership-lost",
			reason: "foreign wrapper over previous md-cache patch — restart required",
		};
	}
	if (typeof current !== "function") {
		return { decision: "unsupported", reason: "Markdown.prototype.render is not a function" };
	}
	const desc = Object.getOwnPropertyDescriptor(Markdown.prototype, "render");
	if (!desc || !desc.writable || !desc.configurable) {
		return {
			decision: "unsupported",
			reason: "Markdown.prototype.render descriptor is not writable+configurable",
		};
	}
	return { decision: "install", hash: hashString(current.toString()) };
}

/**
 * Decide whether seg-cache may install. Independent of md-cache entirely.
 * Fresh path verifies the segment descriptor is writable+configurable and
 * runs a tiny native-behavior canary against the CURRENT prototype method.
 * @returns {{decision: "install"|"adopt"|"unsupported"|"ownership-lost", reason?: string}}
 */
export function evaluateSegSupport() {
	const shared = globalThis[SEG_STATE_KEY];
	const proto = typeof Intl.Segmenter === "function" ? Intl.Segmenter.prototype : null;
	const current = proto ? proto.segment : undefined;
	if (shared) {
		if (current === shared.patched || current === shared.orig) {
			return { decision: "adopt" };
		}
		return {
			decision: "ownership-lost",
			reason: "foreign wrapper over previous seg-cache patch — restart required",
		};
	}
	if (!proto || typeof current !== "function") {
		return { decision: "unsupported", reason: "Intl.Segmenter.prototype.segment missing" };
	}
	const desc = Object.getOwnPropertyDescriptor(proto, "segment");
	if (!desc || !desc.writable || !desc.configurable) {
		return {
			decision: "unsupported",
			reason: "Intl.Segmenter.prototype.segment descriptor is not writable+configurable",
		};
	}
	// Native-behavior canary on a tiny grapheme corpus.
	try {
		const canary = "a\u{1F44D}b"; // "a👍b" → 3 graphemes
		const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
		const records = [...current.call(seg, canary)];
		const ok =
			records.length === 3 &&
			records.every(
				(r) => r && typeof r.segment === "string" && typeof r.index === "number" && r.input === canary,
			) &&
			records.map((r) => r.segment).join("") === canary;
		if (!ok) {
			return { decision: "unsupported", reason: "Intl.Segmenter canary output mismatch" };
		}
	} catch (err) {
		return { decision: "unsupported", reason: `Intl.Segmenter canary threw: ${err}` };
	}
	return { decision: "install" };
}

// ---------------------------------------------------------------------------
// Transitions (evaluate → install/uninstall → lifecycle state)
// ---------------------------------------------------------------------------

/**
 * Evaluate + install md-cache and record the lifecycle state.
 * Never touches seg state. Fresh installs run the behavioral differential
 * canary (patched-vs-original byte equality on a representative corpus) using
 * the host's markdown theme; adopt paths (post-/reload) skip the canary.
 * @param {{Markdown: Function, getCapabilities?: Function, theme?: object|null, budgetChars?: number}} deps
 * @returns {{state: string, reason: string|null}}
 */
export function setupMd({ Markdown, getCapabilities, theme, budgetChars }) {
	const ev = evaluateMdSupport(Markdown);
	if (ev.decision === "unsupported" || ev.decision === "ownership-lost") {
		setState("md", ev.decision, ev.reason ?? null);
		return getState("md");
	}
	if (ev.decision === "install") {
		const canary = canaryVerify({ Markdown, getCapabilities, theme });
		if (!canary.ok) {
			setState("md", "unsupported", canary.reason ?? "differential canary failed");
			return getState("md");
		}
	}
	const res = installMd({ Markdown, getCapabilities, budgetChars });
	if (res.installed) setState("md", "active", null);
	else setState("md", "ownership-lost", res.reason ?? "install refused");
	return getState("md");
}

/**
 * Evaluate + install seg-cache and record the lifecycle state.
 * Never touches md state.
 * @param {{budgetChars?: number}} [opts]
 * @returns {{state: string, reason: string|null}}
 */
export function setupSeg({ budgetChars } = {}) {
	const ev = evaluateSegSupport();
	if (ev.decision === "unsupported" || ev.decision === "ownership-lost") {
		setState("seg", ev.decision, ev.reason ?? null);
		return getState("seg");
	}
	const res = installSeg({ budgetChars });
	if (res.installed) setState("seg", "active", null);
	else setState("seg", "ownership-lost", res.reason ?? "install refused");
	return getState("seg");
}

/**
 * Uninstall md-cache. On ownership loss the shared state is preserved by
 * md-cache.uninstall() and the lifecycle records "ownership-lost".
 * @returns {{restored: boolean, reason?: string}}
 */
export function teardownMd() {
	const res = uninstallMd();
	if (res.restored) setState("md", "inactive", null);
	else setState("md", "ownership-lost", "foreign wrapper present at uninstall — restart required");
	return res;
}

/** @returns {{restored: boolean, reason?: string}} */
export function teardownSeg() {
	const res = uninstallSeg();
	if (res.restored) setState("seg", "inactive", null);
	else setState("seg", "ownership-lost", "foreign wrapper present at uninstall — restart required");
	return res;
}

// ---------------------------------------------------------------------------
// Ownership introspection (/rcstats)
// ---------------------------------------------------------------------------

/**
 * @param {Function} Markdown
 * @returns {"ours"|"original"|"foreign"|"none"} who owns Markdown.prototype.render
 */
export function mdOwnership(Markdown) {
	const shared = globalThis[MD_STATE_KEY];
	if (!shared) return "none";
	const current = Markdown.prototype.render;
	if (current === shared.patched) return "ours";
	if (current === shared.orig) return "original";
	return "foreign";
}

/** @returns {"ours"|"original"|"foreign"|"none"} who owns Intl.Segmenter.prototype.segment */
export function segOwnership() {
	const shared = globalThis[SEG_STATE_KEY];
	if (!shared) return "none";
	const current = Intl.Segmenter.prototype.segment;
	if (current === shared.patched) return "ours";
	if (current === shared.orig) return "original";
	return "foreign";
}
