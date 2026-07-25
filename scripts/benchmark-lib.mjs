/**
 * Shared helpers for the blocked benchmark engine (plan Task 3).
 * No external dependencies; used by benchmark.mjs / benchmark-worker.mjs /
 * evaluate-benchmark.mjs only.
 */
import crypto from "node:crypto";
import fs from "node:fs";

/** Seeded PRNG (mulberry32) — deterministic mode-order shuffles and bootstrap. */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher–Yates shuffle using the provided PRNG. Returns a new array. */
export function shuffled(arr, rand) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** sha256 hex of a file's raw bytes (corpus hash). */
export function sha256File(path) {
	return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

/** Simple CLI flag reader: --name value. Returns def when absent. */
export function flag(args, name, def) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

/** Linear-interpolated quantile of a numeric array (q in [0,1]). */
export function quantile(values, q) {
	if (values.length === 0) return NaN;
	const s = values.slice().sort((a, b) => a - b);
	const pos = (s.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(values) {
	return quantile(values, 0.5);
}

/**
 * Percentile bootstrap CI for the median, resampling WHOLE entries (blocks)
 * with replacement. Fixed seed → reproducible. Never resamples within blocks.
 * @param {number[]} perBlockValues one value per complete block
 * @returns {{median: number, ci95: [number, number], resamples: number}}
 */
export function bootstrapMedianCI(perBlockValues, { resamples = 10_000, seed = 12345 } = {}) {
	const n = perBlockValues.length;
	const rand = mulberry32(seed);
	const medians = new Array(resamples);
	const sample = new Array(n);
	for (let r = 0; r < resamples; r++) {
		for (let i = 0; i < n; i++) sample[i] = perBlockValues[Math.floor(rand() * n)];
		medians[r] = median(sample);
	}
	return {
		median: median(perBlockValues),
		ci95: [quantile(medians, 0.025), quantile(medians, 0.975)],
		resamples,
	};
}

export function readJSON(path) {
	return JSON.parse(fs.readFileSync(path, "utf8"));
}
