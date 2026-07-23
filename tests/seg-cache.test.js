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

test("char-budget eviction (FIFO) and >4KB bypass", () => {
	install({ budgetChars: 1000 });
	try {
		const seg = new Intl.Segmenter("en", { granularity: "word" });
		const a = "aaa ".repeat(150).trim(); // 599 chars
		const b = "bbb ".repeat(150).trim(); // 599 chars
		[...seg.segment(a)];
		assert.equal(getStats().chars, a.length, "chars accounting after first insert");
		[...seg.segment(b)]; // 599+599 > 1000 → evict oldest (a)
		assert.equal(getStats().size, 1, "insertion over budget must evict the first-inserted key");
		assert.equal(getStats().chars, b.length, "evicted entry's chars must be released");
		const m0 = getStats().misses;
		assert.deepEqual([...seg.segment(a)], nat("en", "word", a), "evicted string still segments correctly");
		assert.equal(getStats().misses, m0 + 1, "evicted key must be a miss again");
		// >4KB bypass: never cached, still correct, counted as fallback
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

test("cached RU path: one miss then O(1) identity hits without ICU work", () => {
	install();
	try {
		const str = "Съешь же ещё этих мягких французских булок, да выпей чаю. ".repeat(4);
		const seg = new Intl.Segmenter("ru", { granularity: "word" });
		const before = getStats();
		const cached = seg.segment(str);
		assert.equal(getStats().misses, before.misses + 1, "first call fills exactly one cache entry");

		const stats = getStats();
		for (let i = 0; i < 1000; i++) {
			assert.equal(seg.segment(str), cached, "hot path returns the cached iterable object");
		}
		const after = getStats();
		assert.equal(after.hits, stats.hits + 1000, "every repeat is an O(1) cache hit");
		assert.equal(after.misses, stats.misses, "hot path performs no additional ICU segmentation");
		assert.equal(after.fallbacks, stats.fallbacks, "hot path never falls back to native");
	} finally {
		uninstall();
	}
});
