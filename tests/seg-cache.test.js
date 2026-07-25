import { test } from "node:test";
import assert from "node:assert/strict";

// IMPORTANT: capture the TRUE native segment fn BEFORE any install —
// other test files share this process (node --test may run everything together).
const nativeSegment = Intl.Segmenter.prototype.segment;

const { install, uninstall, getStats } = await import("../src/seg-cache.js");

const STATE_KEY = Symbol.for("render-cache:seg:v1");
const GRANULARITIES = ["grapheme", "word"];
const CORPUS = [
	"", // empty string
	"hello world, plain ASCII 123!", // ASCII fast-path candidate (grapheme)
	"Привет, мир! Как дела сегодня?", // RU
	"สวัสดีครับ ผมชื่อโจ", // thai (dictionary word-breaking)
	"family: 👨‍👩‍👧‍👦 and rainbow 🏳️‍🌈 end", // emoji ZWJ sequences
	"flags 🇹🇭🇷🇺🇺🇸 here", // regional-indicator flags
	"cafe\u0301 nai\u0308ve e\u0301", // combining marks
	"line1\r\nline2\r\n", // CRLF
];

function nat(locale, granularity, str) {
	return [...nativeSegment.call(new Intl.Segmenter(locale, { granularity }), str)];
}

test("diff-corpus: patched === native records (shape + keys), both granularities, cold+hot", () => {
	install();
	try {
		for (const granularity of GRANULARITIES) {
			for (const str of CORPUS) {
				const label = `${granularity}:${JSON.stringify(str)}`;
				const seg = new Intl.Segmenter("en", { granularity });
				const expected = nat("en", granularity, str);
				const before = getStats();
				const cold = [...seg.segment(str)];
				assert.equal(getStats().misses, before.misses + 1, `cold call must be a miss (${label})`);
				const hot = [...seg.segment(str)];
				assert.equal(getStats().hits, before.hits + 1, `hot call must be a hit — ASCII fast-path must cache too (${label})`);
				assert.deepEqual(cold, expected, `cold records diff (${label})`);
				assert.deepEqual(hot, expected, `hot records diff (${label})`);
				for (let i = 0; i < expected.length; i++) {
					assert.deepEqual(Object.keys(cold[i]), Object.keys(expected[i]), `key list diff at ${i} (${label})`);
					assert.equal("isWordLike" in cold[i], granularity === "word", `isWordLike only for word (${label})`);
				}
			}
		}
	} finally {
		uninstall();
	}
});

test("re-iterate, spread, containing() delegation", () => {
	install();
	try {
		const str = "Hello brave new world";
		const seg = new Intl.Segmenter("en", { granularity: "word" });
		const res = seg.segment(str);
		const a = [...res];
		const b = [...res]; // re-iterate after spread
		assert.deepEqual(a, b, "re-iteration must yield the same records");
		let count = 0;
		for (const rec of res) {
			assert.equal(typeof rec.segment, "string");
			count++;
		}
		assert.equal(count, a.length, "for..of after two spreads must still work");
		const natRes = nativeSegment.call(new Intl.Segmenter("en", { granularity: "word" }), str);
		assert.deepEqual({ ...res.containing(5) }, { ...natRes.containing(5) }, "containing(5) must delegate to native");
		assert.deepEqual(res.containing(0), natRes.containing(0));
		assert.equal(res.containing(9999), undefined, "out-of-range containing → undefined like native");
		assert.equal(Object.prototype.propertyIsEnumerable.call(res, "containing"), false, "containing must be non-enumerable");
	} finally {
		uninstall();
	}
});

test("locale isolation: en vs th are distinct cache entries, no cross-contamination", () => {
	install();
	try {
		const str = "สวัสดีครับผมชื่อโจ hello";
		const en = new Intl.Segmenter("en", { granularity: "word" });
		const th = new Intl.Segmenter("th", { granularity: "word" });
		const m0 = getStats().misses;
		const enRes = [...en.segment(str)];
		const thRes = [...th.segment(str)];
		assert.equal(getStats().misses, m0 + 2, "same string under en and th must be TWO cache entries");
		assert.deepEqual(enRes, nat("en", "word", str), "en result must match en native");
		assert.deepEqual(thRes, nat("th", "word", str), "th result must match th native");
		const h0 = getStats().hits;
		assert.deepEqual([...en.segment(str)], enRes);
		assert.deepEqual([...th.segment(str)], thRes);
		assert.equal(getStats().hits, h0 + 2, "repeats must hit their own locale entries");
	} finally {
		uninstall();
	}
});

test("double install is idempotent: Symbol.for singleton, no wrapper layering, state adopted", () => {
	install();
	try {
		const fn1 = Intl.Segmenter.prototype.segment;
		assert.notEqual(fn1, nativeSegment, "install must actually patch");
		const state1 = globalThis[STATE_KEY];
		assert.ok(state1, "shared state must live on globalThis[Symbol.for('render-cache:seg:v1')]");
		assert.equal(getStats().budgetChars, 16_000_000, "default legacy input scales to the 16M cost-unit budget");
		const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
		[...seg.segment("abc")];
		const statsBefore = getStats();
		install(); // simulate /reload re-running the factory
		assert.equal(Intl.Segmenter.prototype.segment, fn1, "reinstall must not layer another wrapper");
		assert.equal(globalThis[STATE_KEY], state1, "reinstall must adopt the existing shared state");
		assert.equal(getStats().misses, statsBefore.misses, "counters must survive reinstall (adopt, not reset)");
		assert.deepEqual([...seg.segment("abc")], nat("en", "grapheme", "abc"), "behavior unchanged after double install");
	} finally {
		uninstall();
	}
	assert.equal(Intl.Segmenter.prototype.segment, nativeSegment, "uninstall must restore the true native fn");
	assert.equal(globalThis[STATE_KEY], undefined, "uninstall must drop the shared state");
});

test("retained-cost accounting, FIFO eviction, per-entry cap, and >4KB bypass", () => {
	const legacyBudgetChars = 8_750;
	const effectiveBudget = legacyBudgetChars * 8;
	install({ budgetChars: legacyBudgetChars });
	try {
		assert.equal(getStats().budgetChars, effectiveBudget, "explicit legacy budget scales by 8");
		const seg = new Intl.Segmenter("en", { granularity: "word" });
		const inputs = "abcde".split("").map((letter) => `${letter}${letter}${letter} `.repeat(150).trim());
		const firstRecords = [...seg.segment(inputs[0])];
		const prefix = `${seg.resolvedOptions().locale}\0word\0`;
		const expectedCost =
			(prefix + inputs[0]).length +
			inputs[0].length +
			firstRecords.length * 48 +
			firstRecords.reduce((sum, record) => sum + record.segment.length, 0);
		assert.equal(getStats().chars, expectedCost, "cost includes key/input, record overhead, and segment strings");
		for (const input of inputs.slice(1)) [...seg.segment(input)];
		assert.equal(getStats().size, 4, "fifth entry evicts the first under the total budget");
		assert.ok(getStats().chars <= effectiveBudget, "estimated retained cost stays within total budget");
		const m0 = getStats().misses;
		assert.deepEqual([...seg.segment(inputs[0])], nat("en", "word", inputs[0]), "evicted input stays correct");
		assert.equal(getStats().misses, m0 + 1, "evicted key re-misses");

		const sizeBeforeCap = getStats().size;
		const manyWords = "x ".repeat(500).trim();
		assert.deepEqual([...seg.segment(manyWords)], nat("en", "word", manyWords));
		assert.equal(getStats().size, sizeBeforeCap, "entry over budget/4 is not retained");

		const big = "word ".repeat(1000); // 5000 chars
		const f0 = getStats().fallbacks;
		const s0 = getStats().size;
		assert.deepEqual([...seg.segment(big)], nat("en", "word", big), "bypassed big string must match native");
		assert.equal(getStats().fallbacks, f0 + 1, ">4KB string must count as fallback");
		assert.equal(getStats().size, s0, ">4KB string must not enter the cache");
	} finally {
		uninstall();
	}
});

test("1000 emoji graphemes are charged conservatively and evict within budget", () => {
	const legacyBudgetChars = 30_000;
	const effectiveBudget = legacyBudgetChars * 8;
	install({ budgetChars: legacyBudgetChars });
	try {
		const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
		const inputs = ["😀", "😁", "😂", "😃", "😄"].map((emoji) => emoji.repeat(1000));
		for (let i = 0; i < inputs.length; i++) {
			const records = [...seg.segment(inputs[i])];
			assert.equal(records.length, 1000, `fixture ${i} has 1000 grapheme records`);
			assert.deepEqual(records, nat("en", "grapheme", inputs[i]), `fixture ${i} matches native`);
		}
		const prefix = `${seg.resolvedOptions().locale}\0grapheme\0`;
		const oneCost =
			(prefix + inputs[0]).length + inputs[0].length + 1000 * 48 + inputs[0].length;
		assert.ok(oneCost > inputs[0].length * 20, "per-record object overhead dominates retained estimate");
		assert.equal(getStats().size, 4, "fifth high-record-count entry evicts the oldest");
		assert.equal(getStats().chars, oneCost * 4, "chars reports conservative retained-cost units");
		assert.equal(getStats().budgetChars, effectiveBudget, "scaled effective budget is reported");
		assert.ok(getStats().chars <= effectiveBudget, "total retained estimate remains bounded");
		const misses = getStats().misses;
		[...seg.segment(inputs[0])];
		assert.equal(getStats().misses, misses + 1, "oldest emoji entry was evicted");
	} finally {
		uninstall();
	}
});

test("perf soft-gate: repeated RU string ≥10× faster than native", () => {
	install();
	try {
		const str = "Съешь же ещё этих мягких французских булок, да выпей чаю. ".repeat(4);
		const seg = new Intl.Segmenter("ru", { granularity: "word" });
		const natSeg = new Intl.Segmenter("ru", { granularity: "word" });
		// warm both paths (cache fill + JIT)
		for (let i = 0; i < 10; i++) {
			[...seg.segment(str)];
			[...nativeSegment.call(natSeg, str)];
		}
		const N = 1000;
		const timeNs = (fn) => {
			const t0 = process.hrtime.bigint();
			for (let i = 0; i < N; i++) fn();
			return Number(process.hrtime.bigint() - t0);
		};
		// Soft gate: best-of-5 per side to shave scheduler/GC noise off a ~ms-scale sample.
		let patchedNs = Infinity;
		let nativeNs = Infinity;
		for (let trial = 0; trial < 5; trial++) {
			patchedNs = Math.min(patchedNs, timeNs(() => [...seg.segment(str)]));
			nativeNs = Math.min(nativeNs, timeNs(() => [...nativeSegment.call(natSeg, str)]));
		}
		const speedup = nativeNs / patchedNs;
		assert.ok(speedup >= 10, `soft perf gate: expected ≥10× speedup, got ${speedup.toFixed(1)}×`);
	} finally {
		uninstall();
	}
});
