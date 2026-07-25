/**
 * C: pure patcher for Intl.Segmenter.prototype.segment — memoizes ICU segmentation.
 * Zero pi deps. Shared state lives on globalThis[Symbol.for("render-cache:seg:v1")]
 * so /reload (fresh module scope) adopts, never layers or resets. See PLAN.md I2-I4.
 *
 * Budget cost units are conservative retained-cost estimates, not source chars.
 * The effective default is 16,000,000 units (≈15,625 KiB estimated retention,
 * not a heap-byte guarantee). Legacy budgetChars inputs are scaled by 8 so the
 * extension's existing 2,000,000 setting receives that effective default.
 */
import { makeBudgetCache, makeCounters } from "./stats.js";

const STATE_KEY = Symbol.for("render-cache:seg:v1");
const MAX_CACHED_STR = 4096; // strings >4KB bypass the cache entirely
const ESTIMATED_RECORD_OVERHEAD = 48; // record object + array slot, conservative cost units
const MAX_ENTRY_BUDGET_DIVISOR = 4;
const LEGACY_BUDGET_CHARS_DEFAULT = 2_000_000;
const COST_UNIT_SCALE = 8;

// Task 4 calibration: observed retained-cost/source-char ratios were ~22–51×
// for segmentation entries. An 8× legacy-input scale restores useful capacity
// without adopting the worst-case ratio as the default hard memory bound;
// Tasks 6/7 may later pass calibrated values after revisiting this contract.
const ASCII_PRINTABLE_RE = /^[\x20-\x7E]*$/;

/** Per-char grapheme records for printable ASCII — skips ICU, same shape as native. */
function asciiGraphemeRecords(str) {
	const records = new Array(str.length);
	for (let i = 0; i < str.length; i++) records[i] = { segment: str[i], index: i, input: str };
	return records;
}

/** Iterable result: re-iterate/spread work; containing() delegates to native (non-enumerable). */
function makeResult(records, segmenter, str, orig) {
	const result = {
		[Symbol.iterator]() {
			return records[Symbol.iterator]();
		},
	};
	Object.defineProperty(result, "containing", {
		value: (index) => orig.call(segmenter, str).containing(index),
		writable: true,
		enumerable: false,
		configurable: true,
	});
	return result;
}

function makePatchedSegment(state) {
	const { orig, cache, counters, resolved } = state;
	return function segment(str) {
		// Non-string input (Symbol throws, objects ToString, ...) → inherit native semantics.
		if (typeof str !== "string") return orig.call(this, str);
		let opts = resolved.get(this); // locale/granularity resolved once per instance
		if (opts === undefined) {
			try {
				const ro = this.resolvedOptions();
				opts = { granularity: ro.granularity, keyPrefix: ro.locale + "\0" + ro.granularity + "\0" };
				resolved.set(this, opts);
			} catch {
				// Exotic/brandless receiver: delegate — orig throws the natural error.
				return orig.call(this, str);
			}
		}
		if (str.length > MAX_CACHED_STR) {
			counters.fallbacks++;
			return orig.call(this, str);
		}
		const key = opts.keyPrefix + str;
		let result = cache.get(key);
		if (result === undefined) {
			counters.misses++;
			const records =
				opts.granularity === "grapheme" && ASCII_PRINTABLE_RE.test(str)
					? asciiGraphemeRecords(str)
					: [...orig.call(this, str)]; // spread native → per-granularity record shape inherited
			// The whole result object is cached: hit path is Map.get + iterate, no allocation.
			// Same locale+granularity → containing() via the first segmenter is equivalent.
			result = makeResult(records, this, str, orig);
			const retainedCost =
				key.length +
				str.length +
				records.length * ESTIMATED_RECORD_OVERHEAD +
				records.reduce((sum, record) => sum + record.segment.length, 0);
			if (retainedCost <= cache.budgetChars / MAX_ENTRY_BUDGET_DIVISOR) {
				cache.set(key, result, retainedCost);
			}
		} else {
			counters.hits++;
		}
		return result;
	};
}

/**
 * Idempotent: adopts existing shared state on reinstall (reload-safe).
 * REFUSES TO LAYER: shared state + foreign prototype fn → {installed:false,
 * reason:"ownership-lost"}, no new wrapper.
 * @returns {{installed: boolean, adopted?: boolean, reason?: string}}
 */
export function install({ budgetChars = LEGACY_BUDGET_CHARS_DEFAULT } = {}) {
	const existing = globalThis[STATE_KEY];
	if (existing) {
		const current = Intl.Segmenter.prototype.segment;
		if (current === existing.patched) return { installed: true, adopted: true };
		if (current === existing.orig) {
			// Pristine prototype with surviving state: re-applying OUR patch is safe.
			Intl.Segmenter.prototype.segment = existing.patched;
			return { installed: true, adopted: true };
		}
		return { installed: false, reason: "ownership-lost" }; // never layer over a foreign fn
	}
	const state = {
		orig: Intl.Segmenter.prototype.segment,
		cache: makeBudgetCache(budgetChars * COST_UNIT_SCALE),
		counters: makeCounters(),
		resolved: new WeakMap(),
		patched: null,
	};
	state.patched = makePatchedSegment(state);
	globalThis[STATE_KEY] = state;
	Intl.Segmenter.prototype.segment = state.patched;
	return { installed: true };
}

/**
 * Restores the original ONLY if prototype.segment is still ours (or already
 * the original). On ownership loss the shared state is PRESERVED — a foreign
 * wrapper may still call our patch, and dropping bookkeeping would let a later
 * install layer a second wrapper.
 * @returns {{restored: boolean, reason?: string}}
 */
export function uninstall() {
	const state = globalThis[STATE_KEY];
	if (!state) return { restored: true }; // nothing installed → already pristine
	const current = Intl.Segmenter.prototype.segment;
	if (current === state.patched) {
		Intl.Segmenter.prototype.segment = state.orig;
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
	if (!state) return { hits: 0, misses: 0, fallbacks: 0, size: 0, chars: 0, budgetChars: 0 };
	const { hits, misses, fallbacks } = state.counters;
	return { hits, misses, fallbacks, size: state.cache.size, chars: state.cache.chars, budgetChars: state.cache.budgetChars };
}
