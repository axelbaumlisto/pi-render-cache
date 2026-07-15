/**
 * Diff-tests for the Markdown.prototype.render incremental-cache patcher (PLAN.md Шаг 3).
 * Spec = invariants I1/I3/I4/I5/I6: patched === orig BYTE-FOR-BYTE on everything,
 * incl. the adversarial corpus from research/ROUND2_review_1.md §3.
 *
 * TEST HYGIENE: the TRUE original render is captured BEFORE any install;
 * every test uninstalls in finally (process may be shared with other files).
 * Byte-compare baseline always goes through origRender.call(freshInstance, w).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPiTui, loadTheme } from "./helpers.js";

const tui = await loadPiTui();
const themeMod = await loadTheme();
const { Markdown, getCapabilities } = tui;

// IMPORTANT: capture the pristine original BEFORE any install.
const origRender = Markdown.prototype.render;

const { install, uninstall, getStats } = await import("../src/md-cache.js");

const STATE_KEY = Symbol.for("render-cache:md:v1");
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const mdTheme = themeMod.getMarkdownTheme();
const WIDTHS = [20, 24, 47, 80];

/** Pristine render via the saved original method (never the patch). */
function renderOrig(text, width, paddingX = 1) {
	return origRender.call(new Markdown(text, paddingX, 0, mdTheme), width);
}
/** Patched render on a fresh instance (simulates updateContent's cold rebuild). */
function renderPatched(text, width, paddingX = 1) {
	return new Markdown(text, paddingX, 0, mdTheme).render(width);
}
function assertSame(text, width, msg) {
	assert.deepEqual(
		renderPatched(text, width),
		renderOrig(text, width),
		`${msg} [w=${width}] ${JSON.stringify(text.slice(0, 70))}`,
	);
}
function assertCorpus(texts, msg, widths = WIDTHS) {
	for (const text of texts) for (const w of widths) assertSame(text, w, msg);
}

function makeStreamDoc() {
	let s = "# Release notes\n\n";
	for (let i = 0; i < 14; i++) {
		s += `## Section ${i}\n\nParagraph ${i} with **bold**, *italic*, \`code\`, a link https://example.com/${i}, русский текст и emoji 🚀.\n\n`;
		s += `- item one of section ${i}\n- item two of section ${i}\n  - nested ${i}\n\n`;
		s += "```js\nfunction f" + i + "() {\n  return " + i + ";\n}\n```\n\n";
		s += `| col a | col b |\n| --- | ---: |\n| ${i} | ${i * 2} |\n\n`;
	}
	return s + "Final paragraph wraps things up nicely.\n";
}

// ─── 1. I1: base corpus × widths [20,24,47,80] ───────────────────────────────

const BASE_CORPUS = [
	"# Title\n\nIntro paragraph with **bold**, *italic*, `code`, ~~strike~~ and a [link](https://example.com).\n\n## Section two\n\nMore text follows here.\n",
	"Nested lists:\n\n- alpha\n- beta\n  - gamma\n  - delta\n    - epsilon\n- zeta\n\n1. one\n2. two\n   1. two-a\n\ndone\n",
	"Intro\n\n| name | qty | price |\n| --- | ---: | ---: |\n| apple | 3 | 1.50 |\n| банан | 12 | 0.75 |\n\nAfter table\n",
	"Code:\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n\n```python\ndef f(x):\n    return x * 2\n```\n\n```\nno lang\n```\n\ntail\n",
	"Русский текст в абзаце, довольно длинный, чтобы переноситься на узких ширинах терминала.\n\nสวัสดีครับ ผมชื่อโจ และนี่คือข้อความภาษาไทย\n\nemoji: 👨‍👩‍👧‍👦 🏳️‍🌈 🇹🇭 🚀 done\n\nfin\n",
	"long line: " + "supercalifragilistic ".repeat(20) + "\n\nnext para\n",
	"> quote line one\n> quote line two\n\nplain after quote\n\n---\n\nafter hr\n",
	"# H1\n\n## H2\n\n### H3 with *emph*\n\n#### H4\n\n##### H5\n\n###### H6\n\nbody\n",
	"", // [] semantics
	"   \n \n", // whitespace-only → [] semantics
	"single line no newline",
	"para one\n\npara two\n\n\n\npara three after double blank run\n", // seam contract
];

test("I1: base corpus — patched === pristine orig byte-for-byte, all widths", () => {
	install({ Markdown, getCapabilities });
	try {
		assertCorpus(BASE_CORPUS, "base corpus");
		// paddingX is a KEY component, not a fallback: 0/1/2 interleaved, no cross-talk
		const doc = BASE_CORPUS[0];
		for (const px of [0, 2, 1, 0]) {
			assert.deepEqual(
				new Markdown(doc, px, 0, mdTheme).render(47),
				renderOrig(doc, 47, px),
				`paddingX=${px} keyed correctly`,
			);
		}
		const s = getStats();
		assert.ok(s.hits + s.misses > 0, "corpus must exercise the cache path, not only fallbacks");
	} finally {
		uninstall();
	}
});

// ─── 1b. I1-adversarial (ROUND2_review_1.md §3 — MANDATORY) ─────────────────

const REF_DEF_CORPUS = [
	"[ref]: https://x.com\n\nsee [ref] please\n",
	"see [ref] please\n\n[ref]: https://x.com\n",
	"see it\n\n[foo\n\nbar]: /url", // def label spanning a blank line (line-local killer)
	"> [x]: /url\n> quote\n\nsee [x] here\n",
	"- [x]: /url\n\nsee [x] here\n",
	"[Foo]: /url\n\nuse [FOO] here\n",
	"see [foo][]\n\n[foo]: /url\n",
	"![alt][x]\n\n[x]: /pic.png\n",
	'[x]: /url\n    "title"\n\npara\n',
	"[x]: /url (title)\n\npara\n",
	"text[^1]\n\n[^1]: note\n",
	"# see [x]\n\n[x]: /url\n",
	"| [x] |\n| --- |\n| y |\n\n[x]: /url\n",
];

test("I1-adversarial: ref-defs across the boundary (both directions, all variants)", () => {
	install({ Markdown, getCapabilities });
	try {
		assertCorpus(REF_DEF_CORPUS, "ref-def corpus");
	} finally {
		uninstall();
	}
});

test("I1-adversarial: unclosed HTML 1-5 (8 openers × heading/styled tail) + closed counterparts", () => {
	install({ Markdown, getCapabilities });
	try {
		const openers = ["<pre>", "<script>", "<style>", "<textarea>", "<!--", "<?", "<!X", "<![CDATA["];
		const docs = [];
		for (const op of openers) {
			for (const tail of ["# Heading\n\nafter\n", "some *emph* text\n"]) {
				docs.push(`${op}\nraw stuff\n\n${tail}`);
			}
		}
		// CLOSED counterparts: identity via split-level fallback OR safe boundary — byte-identical either way
		docs.push(
			"<pre>x</pre>\n\n# Heading\n",
			"<script>x=1</script>\n\nsome *emph* text\n",
			"<!-- note -->\n\n# Heading\n",
			"<?php echo 1 ?>\n\npara\n",
			"<!X doctype-ish>\n\npara\n",
			"<![CDATA[x]]>\n\npara\n",
			"<style>.a{}</style>\n\npara\n",
			"<textarea>t</textarea>\n\npara\n",
			"<div>\ntype six\n</div>\n\npara after type-6\n",
		);
		assertCorpus(docs, "HTML blocks 1-5");
	} finally {
		uninstall();
	}
});

test("I1-adversarial: <a inLink leaks (paragraph/heading/list/quote/table) + balanced-safe + email tail", () => {
	install({ Markdown, getCapabilities });
	try {
		assertCorpus(
			[
				'click <a href="x">here\n\nvisit www.example.com\n',
				'x <a href="u">y\n\nwrite foo@bar.com\n',
				'hi <A HREF="x">y\n\nvisit www.example.com\n',
				'# h <a href="x">t\n\nvisit www.example.com\n',
				'- item <a href="x">t\n\nvisit www.example.com\n',
				'> q <a href="x">t\n\nvisit www.example.com\n',
				'| <a href="x">t |\n| --- |\n| y |\n\nvisit www.example.com\n',
				'see <a href="x">y</a> ok\n\nvisit www.example.com\n', // balanced — safe
				"x <a>y</a> z\n\nwrite foo@bar.com\n", // <a> w/o space — safe, email tail
			],
			"inLink corpus",
		);
	} finally {
		uninstall();
	}
});

test("I1-adversarial: list continuation, indented code, blank-run pathologies", () => {
	install({ Markdown, getCapabilities });
	try {
		assertCorpus(
			[
				"- a\n- b\n\n- c\n", // loose merge
				"- a\n- b\n\n  cont\n", // retro-loose flip
				"- item\n\n    code?\n", // 4-space after item
				"- a\n  - b\n\n    cont\n", // nested continuation
				"- a\n- b\n\n   t t t\n", // 3-space at narrow widths
				"- a\n- b\n\n\tcont\n", // tab-indented tail
				"1. a\n\n2. b\n", // ordered merge
				"- a\n\n\n- b\n", // double blank, one loose list
				"- " + "word ".repeat(12) + "\n\n  " + "tail ".repeat(10) + "\n", // itemWidth wrap divergence
				"    code1\n\n    code2\n", // indented code absorbs the blank
				"    indented code line\n\nPlain paragraph after indented code.\n\n", // settled-final indented code keeps trailing \n standalone (fuzz find)
				"para\n\n\n\nnext\n", // mid-blank-run
				"\n\npara\n", // blank-only prefix
				"  \n\t\npara\n", // whitespace-blank prefix
				"para\r\n\r\nnext\r\n", // CRLF
				"para\rmore\n\nnext\n", // lone \r
			],
			"list/blank corpus",
		);
	} finally {
		uninstall();
	}
});

test("I1-adversarial: fence-tracker cases + partial closing fence near boundary", () => {
	install({ Markdown, getCapabilities });
	try {
		assertCorpus(
			[
				"```js\ncode\n```\n\npara\n",
				"````\ncode\n```\n\npara\n", // still open (closer shorter)
				"~~~\ncode\n~~~\n\npara\n",
				"```\ncode\n~~~\n\npara\n", // char mismatch, still open
				"``` `x\ntext\n\npara\n", // backtick in info = paragraph
				"~~~ `x\ncode\n\npara\n", // tilde info may contain backticks
				"```\ncode\n```   \n\npara\n", // trailing-space closer
				"```\ncode\n``` x\n\npara\n", // closer with info does not close
				"```\ncode\n   ```\n\npara\n", // 3-space closer
				"```\ncode\n    ```\n\npara\n", // 4-space = content
				"````\n```\ninner\n```\n````\n\npara\n", // nested
				"- x\n  ```\n  code\n\npara\n", // open fence in list item
				"    ```\nx\n\npara\n", // 4-space ``` = indented code
				"intro\n\n```js\ncode\n``", // partial closing fence (trimPartialClosingFences)
				"intro\n\n```js\ncode\n```\n\ndone\n",
				"```\ncode\n\nnot code?\n", // boundary inside open fence
			],
			"fence corpus",
		);
	} finally {
		uninstall();
	}
});

// ─── 2. I5: stream simulation ────────────────────────────────────────────────

test("I5 stream-sim: ~40-char chunks, fresh instance each step, resize mid-stream", () => {
	install({ Markdown, getCapabilities });
	try {
		const doc = makeStreamDoc();
		assert.ok(doc.length >= 3000 && doc.length <= 5500, `doc size sane (${doc.length})`);
		let step = 0;
		for (let i = 40; i < doc.length + 40; i += 40) {
			const text = doc.slice(0, Math.min(i, doc.length));
			const w = step < 30 ? 80 : 47; // resize at chunk 30
			assert.deepEqual(
				new Markdown(text, 1, 0, mdTheme).render(w),
				renderOrig(text, w),
				`stream step ${step} (len=${text.length}, w=${w})`,
			);
			step++;
		}
		assert.ok(getStats().hits > 10, `stream must produce cache hits (got ${getStats().hits})`);
	} finally {
		uninstall();
	}
});

test("I5 stream-sim: hazard arriving at chunk N resets settled, output identical", () => {
	install({ Markdown, getCapabilities });
	try {
		const doc =
			"intro paragraph here\n\nsecond block of text\n\nthird block follows on\n\n[x]: /url\n\nsee [x] reference now\n";
		const f0 = getStats().fallbacks;
		for (let i = 10; i < doc.length + 10; i += 10) {
			const text = doc.slice(0, Math.min(i, doc.length));
			assert.deepEqual(
				new Markdown(text, 1, 0, mdTheme).render(80),
				renderOrig(text, 80),
				`hazard stream step at len=${text.length}`,
			);
		}
		assert.ok(getStats().fallbacks > f0, "hazard steps must go through the fallback path");
	} finally {
		uninstall();
	}
});

// ─── 3. I1-theme: no stale cache after global theme switch ───────────────────

test("I1-theme: setGlobalTheme between renders → new ANSI, no stale cache", () => {
	install({ Markdown, getCapabilities });
	const saved = globalThis[THEME_KEY];
	try {
		const doc = "# Heading here\n\nparagraph body text\n\n## Second heading\n\nmore body\n";
		const before = new Markdown(doc, 1, 0, mdTheme).render(80);
		assert.deepEqual(before, renderOrig(doc, 80), "pre-switch render matches orig");
		// A DIFFERENT theme instance: clone of dark with a different heading color.
		const alt = Object.assign(Object.create(Object.getPrototypeOf(saved)), saved);
		alt.fgColors = new Map(saved.fgColors);
		alt.fgColors.set("mdHeading", "\x1b[38;5;213m");
		themeMod.setGlobalTheme(alt);
		const after = new Markdown(doc, 1, 0, mdTheme).render(80); // same mdTheme wrapper object!
		assert.notDeepEqual(after, before, "sanity: theme switch must change bytes");
		assert.deepEqual(after, renderOrig(doc, 80), "post-switch render must reflect the NEW theme");
		// switch back: the OLD entries must be served again, still correct
		themeMod.setGlobalTheme(saved);
		assert.deepEqual(new Markdown(doc, 1, 0, mdTheme).render(80), before, "back-switch → original bytes");
	} finally {
		themeMod.setGlobalTheme(saved);
		uninstall();
	}
});

// ─── 4. I6: fallbacks (paddingY, options, defaultTextStyle, non-string) ─────

test("I6 fallbacks: paddingY=1 / options / defaultTextStyle → counter grows, output === orig", () => {
	install({ Markdown, getCapabilities });
	try {
		const doc = "# H\n\n1. one\n2. two\n\npara body\n";
		const cases = [
			["paddingY=1", () => new Markdown(doc, 1, 1, mdTheme)],
			["options", () => new Markdown(doc, 1, 0, mdTheme, undefined, { preserveOrderedListMarkers: true })],
			["defaultTextStyle", () => new Markdown(doc, 1, 0, mdTheme, { italic: true })],
			["non-string text", () => new Markdown(undefined, 1, 0, mdTheme)],
		];
		for (const [name, make] of cases) {
			const f0 = getStats().fallbacks;
			assert.deepEqual(make().render(80), origRender.call(make(), 80), `${name}: output === orig`);
			assert.ok(getStats().fallbacks > f0, `${name}: fallback counter must grow`);
		}
	} finally {
		uninstall();
	}
});

// ─── 5. I3: double install → single layer, state adopted ────────────────────

test("I3: double install keeps render fn identity, adopts shared state; uninstall restores", () => {
	install({ Markdown, getCapabilities });
	try {
		const fn1 = Markdown.prototype.render;
		assert.notEqual(fn1, origRender, "install must actually patch");
		const state1 = globalThis[STATE_KEY];
		assert.ok(state1, "shared state on globalThis[Symbol.for('render-cache:md:v1')]");
		assert.equal(typeof state1.origHash, "string", "version-drift hash stored at first install");
		renderPatched("a\n\nb\n", 80);
		const stats = getStats();
		install({ Markdown, getCapabilities }); // simulate /reload re-running the factory
		assert.equal(Markdown.prototype.render, fn1, "reinstall must not layer another wrapper");
		assert.equal(globalThis[STATE_KEY], state1, "reinstall must adopt existing shared state");
		assert.deepEqual(getStats(), stats, "counters survive reinstall (adopt, not reset)");
		assertSame("a\n\nb\n\nc\n", 80, "behavior unchanged after double install");
	} finally {
		uninstall();
	}
	assert.equal(Markdown.prototype.render, origRender, "uninstall restores the pristine original");
	assert.equal(globalThis[STATE_KEY], undefined, "uninstall drops the shared state");
});

// ─── 6. I4: char budget → eviction, no breakage ─────────────────────────────

test("I4: small char budget evicts FIFO, nothing breaks", () => {
	install({ Markdown, getCapabilities, budgetChars: 200 });
	try {
		const docA = "A".repeat(150) + "\n\nnext line a\n"; // settled cost 151
		const docB = "B".repeat(150) + "\n\nnext line b\n";
		assertSame(docA, 80, "docA before eviction");
		assert.equal(getStats().size, 1, "docA settled cached");
		assertSame(docB, 80, "docB insert evicts docA (151+151 > 200)");
		assert.equal(getStats().size, 1, "FIFO eviction kept exactly one entry");
		assert.ok(getStats().chars <= 200, `chars within budget (${getStats().chars})`);
		assertSame(docA, 80, "evicted docA still renders correctly (re-miss)");
		// entry bigger than the whole budget: never cached, still correct
		assertSame("C".repeat(500) + "\n\ntail c\n", 80, "oversized settled bypasses cache");
	} finally {
		uninstall();
	}
});

// ─── extra coherence: per-instance cache + fresh array ownership ────────────

test("per-instance coherence: second render(width) is the O(1) instance path (same ref)", () => {
	install({ Markdown, getCapabilities });
	try {
		const md = new Markdown("x\n\ny\n", 1, 0, mdTheme);
		const a = md.render(80);
		const b = md.render(80);
		assert.equal(a, b, "double-call (Container/overlay) must return the instance-cached array");
		md.invalidate();
		assert.deepEqual(md.render(80), a, "render after invalidate() still correct");
	} finally {
		uninstall();
	}
});

test("fresh array ownership: mutating a returned array never corrupts the global cache", () => {
	install({ Markdown, getCapabilities });
	try {
		const doc = "alpha block\n\nbeta block\n\ngamma block\n";
		const expected = renderOrig(doc, 80);
		const a = new Markdown(doc, 1, 0, mdTheme).render(80);
		const b = new Markdown(doc, 1, 0, mdTheme).render(80);
		assert.notEqual(a, b, "two instances must not share the returned array object");
		a.push("MUTATED");
		a[0] = "CLOBBERED";
		assert.deepEqual(new Markdown(doc, 1, 0, mdTheme).render(80), expected, "cache unaffected by mutation");
	} finally {
		uninstall();
	}
});

// ─── 7. perf hard gate: ≥5× on a 16KB stream ────────────────────────────────

test("perf hard gate: 16KB doc streamed by 40-char chunks — patched ≥5× faster (best-of-3)", () => {
	let doc = "# Performance corpus\n\n";
	let i = 0;
	while (doc.length < 16384) {
		doc +=
			`## Section ${i}\n\nParagraph ${i}: ` +
			"lorem ipsum dolor sit amet consectetur adipiscing ".repeat(2) +
			`и немного русского текста 🚀.\n\n- item a${i}\n- item b${i}\n\n` +
			"```js\nconst v" + i + " = " + i + ";\n```\n\n";
		i++;
	}
	const timeStream = (renderFn) => {
		const t0 = process.hrtime.bigint();
		for (let pos = 40; pos < doc.length + 40; pos += 40) {
			renderFn(doc.slice(0, Math.min(pos, doc.length)));
		}
		return Number(process.hrtime.bigint() - t0);
	};
	// orig baseline FIRST (nothing installed → truly pristine), best-of-3
	let origNs = Infinity;
	for (let t = 0; t < 3; t++) origNs = Math.min(origNs, timeStream((text) => renderOrig(text, 80)));
	install({ Markdown, getCapabilities });
	let patchedNs = Infinity;
	try {
		for (let t = 0; t < 3; t++) {
			patchedNs = Math.min(patchedNs, timeStream((text) => new Markdown(text, 1, 0, mdTheme).render(80)));
		}
	} finally {
		uninstall();
	}
	const speedup = origNs / patchedNs;
	assert.ok(speedup >= 5, `hard perf gate: expected ≥5×, got ${speedup.toFixed(2)}× (orig ${(origNs / 1e6).toFixed(0)}ms, patched ${(patchedNs / 1e6).toFixed(0)}ms)`);
});

// ─── 8. fuzz gate: seeded random docs, patched === orig ─────────────────────

test("fuzz gate: ≥500 seeded random fragment concatenations × widths {20,47,80}", () => {
	// mulberry32 — deterministic, reproducible by seed
	const SEED = 0xc0ffee;
	let s = SEED;
	const rnd = () => {
		s |= 0; s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
	const FRAGS = [
		"# Heading one\n",
		"## Sub *heading* two\n",
		"Plain paragraph with several words that wrap at narrow widths just fine.\n",
		"Пример русского текста в абзаце для юникода и переносов.\n",
		"emoji 👨‍👩‍👧‍👦 and flag 🇹🇭 here\n",
		"- item one\n- item two\n  - nested three\n",
		"1. first\n2. second\n",
		"```js\nconst x = 1;\n```\n",
		"~~~\nplain code fence\n~~~\n",
		"| a | b |\n| --- | --- |\n| 1 | 2 |\n",
		"> quoted text line\n> more of the quote\n",
		"[ref]: https://example.com\n",
		'see [ref] and <a href="x">open link\n',
		"<pre>\nraw html block\n",
		"    indented code line\n",
		"Text with `code`, **bold**, www.example.com autolink and ~~strike~~.\n",
	];
	const SEPS = ["\n", "\n\n", "\n\n\n"];
	install({ Markdown, getCapabilities });
	try {
		for (let d = 0; d < 500; d++) {
			const nFrags = 2 + Math.floor(rnd() * 6);
			let doc = "";
			for (let f = 0; f < nFrags; f++) doc += pick(FRAGS) + pick(SEPS);
			if (rnd() < 0.3) doc = doc.slice(0, Math.max(1, Math.floor(rnd() * doc.length))); // partial last line
			for (const w of [20, 47, 80]) {
				assert.deepEqual(
					renderPatched(doc, w),
					renderOrig(doc, w),
					`fuzz seed=${SEED} doc#${d} w=${w}:\n${JSON.stringify(doc)}`,
				);
			}
		}
		const st = getStats();
		assert.ok(st.hits + st.misses > 0, "fuzz must exercise the cache path");
	} finally {
		uninstall();
	}
});
