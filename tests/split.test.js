/**
 * Unit tests for splitSettled() — pure markdown boundary heuristic (PLAN.md Шаг 2).
 * Rules H1-H4 + B1-B7 (B7: fuzz-found indented-code seam, review follow-up F1).
 * Covers ROUND2_review_1.md §3 corpus items 1-12 at the split level.
 * ZERO pi imports — runs in milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSettled } from "../src/split.js";

/** Assert full-fallback: hazard anywhere → settled === "" and tail === text. */
function assertFallback(text, msg) {
	const r = splitSettled(text);
	assert.equal(r.settled, "", msg);
	assert.equal(r.tail, text, `${msg} (tail must be whole text)`);
}

/** Assert exact split + concatenation identity (settled+tail === ORIGINAL text). */
function assertSplit(text, settled, msg) {
	const r = splitSettled(text);
	assert.equal(r.settled, settled, msg);
	assert.equal(r.settled + r.tail, text, `${msg} (concat identity)`);
}

// ─── Group 1: fence tracker ───────────────────────────────────────────────────

test("fence: closed backtick fence before blank+plain → boundary after fence", () => {
	assertSplit("```js\ncode\n```\n\npara\n", "```js\ncode\n```\n", "closed fence is settled");
});

test("fence: ```` opener is NOT closed by ``` (closer length ≥ opener)", () => {
	assertFallback("````\ncode\n```\n\npara\n", "4-tick fence still open");
});

test("fence: ~~~ fence closes with ~~~", () => {
	assertSplit("~~~\ncode\n~~~\n\npara\n", "~~~\ncode\n~~~\n", "tilde fence closed");
});

test("fence: char mismatch — ``` not closed by ~~~", () => {
	assertFallback("```\ncode\n~~~\n\npara\n", "mixed-char closer does not close");
});

test("fence: backtick opener with ` in info string is NOT a fence", () => {
	// ``` `x is a paragraph (verified against renderer) → no open fence → boundary OK
	assertSplit("``` `x\ntext\n\npara\n", "``` `x\ntext\n", "backtick-in-info = paragraph");
});

test("fence: ~~~ info string MAY contain backticks (still a fence)", () => {
	assertFallback("~~~ `x\ncode\n\npara\n", "tilde fence with backtick info stays open");
});

test("fence: closer with trailing spaces closes; closer with info does NOT", () => {
	assertSplit("```\ncode\n```   \n\npara\n", "```\ncode\n```   \n", "trailing-space closer valid");
	assertFallback("```\ncode\n``` x\n\npara\n", "closer with non-empty info does not close");
});

test("fence: closer with ≤3 leading spaces closes; 4-space line is content", () => {
	assertSplit("```\ncode\n   ```\n\npara\n", "```\ncode\n   ```\n", "3-space closer valid");
	assertFallback("```\ncode\n    ```\n\npara\n", "4-space '```' is fence content");
});

test("fence: nested — inner ``` inside ```` block is content, ```` closes", () => {
	assertSplit(
		"````\n```\ninner\n```\n````\n\npara\n",
		"````\n```\ninner\n```\n````\n",
		"outer 4-tick fence closes only on ````",
	);
});

test("fence: unclosed fence at 2-space indent (list item) blocks boundaries (conservative)", () => {
	assertFallback("- x\n  ```\n  code\n\npara\n", "indented open fence → no boundary");
});

test("fence: 4-space-indented ``` is NOT a fence opener (indented code)", () => {
	assertSplit("    ```\nx\n\npara\n", "    ```\nx\n", "4-space ``` does not open a fence");
});

// ─── Group 2: hazards H1-H4 → settled "" ────────────────────────────────────

test("H1: ']:' anywhere → fallback (ref-def, §3 items 1-5)", () => {
	// §3.1 def↔usage both directions
	assertFallback("[ref]: /url\n\nsee [ref]\n", "def in prefix");
	assertFallback("see [ref]\n\n[ref]: /url\n", "def in tail");
	// §3.2 KILLER: def label spanning a blank line — tail LOOKS like a plain paragraph
	assertFallback("see it\n\n[foo\n\nbar]: /url", "blank-line-spanning def label");
	// §3.3 defs inside blockquote / list item
	assertFallback("> [x]: /url\n> q\n\nsee [x]\n", "def in blockquote");
	assertFallback("- [x]: /url\n\nsee [x]\n", "def in list item");
	// §3.4 case-insensitive, collapsed, image reflink, titles, pseudo-footnote
	assertFallback("[Foo]: /url\n\nuse [FOO]\n", "case-insensitive def");
	assertFallback("see [foo][]\n\n[foo]: /url\n", "collapsed reflink");
	assertFallback("![alt][x]\n\n[x]: /pic.png\n", "image reflink");
	assertFallback('[x]: /url\n    "title"\n\npara\n', "title on next line");
	assertFallback("[x]: /url (title)\n\npara\n", "paren title");
	assertFallback("text[^1]\n\n[^1]: note\n", "pseudo-footnote def");
	// §3.5 usage in heading / table cell + def across boundary
	assertFallback("# see [x]\n\n[x]: /url\n", "usage in heading");
	assertFallback("| [x] |\n| --- |\n| y |\n\n[x]: /url\n", "usage in table cell");
});

test("H2: '<a ' anywhere (case-insensitive) → fallback (§3 item 7)", () => {
	assertFallback('click <a href="x">here\n\nvisit www.example.com\n', "inLink leak → autolink");
	assertFallback('x <a href="u">y\n\nwrite foo@bar.com\n', "inLink leak → email");
	assertFallback('hi <A HREF="x">y\n\nvisit www.example.com\n', "uppercase <A HREF");
	assertFallback('# h <a href="x">t\n\npara\n', "<a in heading");
	assertFallback('- item <a href="x">t\n\npara\n', "<a in list item");
	// Conservative per plan: even balanced <a…></a> and fenced '<a ' fall back
	assertFallback('see <a href="x">y</a> ok\n\npara\n', "balanced <a …> (conservative)");
	assertFallback('```\n<a href="x">\n```\n\npara\n', "<a inside fence (conservative)");
	// tab counts as the space after '<a' (renderer normalizes \t→3 spaces pre-lex)
	assertFallback('see <a\thref="x">y\n\npara\n', "<a TAB href");
});

test("H2 negative: '<a>' without a space does NOT set inLink → no fallback", () => {
	assertSplit("x <a>y</a> z\n\npara\n", "x <a>y</a> z\n", "<a> w/o space is safe");
});

test("H3: HTML block types 1-5 openers (all 8) × heading/styled tail → fallback (§3 item 6)", () => {
	const openers = ["<pre>", "<script>", "<style>", "<textarea>", "<!--", "<?", "<!X", "<![CDATA["];
	for (const op of openers) {
		for (const tail of ["# Heading", "some *emph* text"]) {
			assertFallback(`${op}\nraw\n\n${tail}\n`, `unclosed ${op} + '${tail}'`);
		}
	}
	// closed counterparts ALSO fall back at split level (plan H3 = conservative presence-scan)
	assertFallback("<pre>x</pre>\n\n# Heading\n", "closed <pre> (conservative presence-scan)");
	// up to 3 leading spaces still an HTML block opener
	assertFallback("   <pre>\nraw\n\npara\n", "3-space-indented <pre");
});

test("H3 negatives: <div> (type 6) is NOT a hazard; 4-space <pre is indented code (→ B7 fallback)", () => {
	assertSplit("<div>\nx\n</div>\n\npara\n", "<div>\nx\n</div>\n", "type-6 block ends at blank");
	// not an H3 hazard, but the settled would end in indented code → B7 rejects the boundary
	assertFallback("    <pre>\n\npara\n", "4-space <pre = indented code → B7 fallback");
});

test("H3: opener INSIDE a closed fence is ignored", () => {
	assertSplit("```\n<pre>\n```\n\npara\n", "```\n<pre>\n```\n", "<pre> is fence content");
});

test("H4: lone \\r (not \\r\\n) → fallback", () => {
	assertFallback("para\rmore\n\nnext\n", "lone CR mid-line");
	assertFallback("para\r\rnext\n\npara\n", "CR CR");
});

// ─── Group 3: boundary rules B1-B6 individually ──────────────────────────────

test("B1: boundary only after ≥1 blank line; blank run belongs ENTIRELY to tail", () => {
	assertFallback("para\nnext\n", "no blank line → no boundary");
	assertSplit("para\n\nnext\n", "para\n", "settled ends with \\n of last block");
	// double/triple blank run — all of it in tail
	const r = splitSettled("para\n\n\n\nnext\n");
	assert.equal(r.settled, "para\n", "settled excludes blank run");
	assert.equal(r.tail, "\n\n\nnext\n", "entire blank run in tail");
	// blank lines containing spaces/tabs count as blank (§3 item 10)
	assertSplit("para\n \t\nnext\n", "para\n", "space/tab-only line is blank");
});

test("B2: prefix must contain a non-blank character (blank-only prefix rejected)", () => {
	assertFallback("\n\npara\n", "blank-only prefix");
	assertFallback("  \n\t\npara\n", "whitespace-only prefix");
});

test("B3: open fence at boundary → rejected", () => {
	assertFallback("```\ncode\n\nnot code?\n", "boundary inside open fence");
});

test("B4: last line unfinished (no \\n) → not a boundary", () => {
	assertFallback("para\n\nnex", "growing first line could change class (1 → 1. bullet)");
	assertSplit("para\n\nnext\n", "para\n", "same line completed → boundary OK");
});

test("B5: leading whitespace on L → rejected (list continuation, indented code)", () => {
	// §3 item 8: full list-continuation set
	assertFallback("- a\n- b\n\n  cont\n", "2-space continuation (retro-loose flip)");
	assertFallback("- item\n\n    code?\n", "4-space after item");
	assertFallback("- a\n  - b\n\n    cont\n", "nested item continuation");
	assertFallback("- a\n- b\n\n   t t t\n", "3-space continuation");
	assertFallback("- a\n- b\n\n\tcont\n", "tab-indented tail (\\t → 3 spaces normalization)");
	// §3 item 9: indented code absorbs blanks
	assertFallback("    code1\n\n    code2\n", "indented code across blank");
});

test("B6: rejected starters — bullets, ordered, quote, table, html, [, #x, fence, =, _", () => {
	assertFallback("- a\n- b\n\n- c\n", "loose-merge bullet tail");
	assertFallback("1. a\n\n2. b\n", "ordered merge");
	assertFallback("- a\n\n\n- b\n", "double blank, still one loose list");
	assertFallback("para\n\n123456789. x\n", "9-digit ordered marker");
	assertFallback("para\n\n> quote\n", "blockquote starter");
	assertFallback("para\n\n| a | b |\n", "table starter");
	assertFallback("para\n\n<div>x\n", "'<' starter");
	assertFallback("para\n\n[link](x)\n", "'[' starter");
	assertFallback("para\n\n#hashtag\n", "# without space is not ATX → reject");
	assertFallback("para\n\n####### seven\n", "7 hashes is not a heading → reject");
	assertFallback("para\n\n= x\n", "'=' starter");
	assertFallback("para\n\n_em_\n", "'_' starter");
	assertFallback("para\n\n~~~\ncode\n~~~\n", "'~' starter (fence opener)");
	assertFallback("para\n\n+ item\n", "'+' bullet");
	assertFallback("para\n\n* item\n", "'*' bullet");
});

test("B6: accepted starters — ATX heading and plain paragraph", () => {
	assertSplit("para\n\n# Head\n", "para\n", "ATX heading tail");
	assertSplit("para\n\n###### six\n", "para\n", "h6 tail");
	assertSplit("para\n\n#\theading-by-tab\n", "para\n", "ATX with tab after hashes");
	assertSplit("para\n\nplain text\n", "para\n", "plain starter");
	assertSplit("para\n\n1234567890 not a bullet\n", "para\n", "10 digits ≠ ordered marker");
	assertSplit("para\n\n1979 year (no dot)\n", "para\n", "digits without [.)] are plain");
});

test("boundary choice: LAST safe boundary wins (maximize settled)", () => {
	assertSplit("a\n\nb\n\nc\n", "a\n\nb\n", "settled up to last boundary");
	assertSplit("a\n\nb\n\nc\n\n# d\n", "a\n\nb\n\nc\n", "heading as last boundary");
});

// ─── Group 3b: B7 — settled must not end with an indented-code line ───────────

test("B7: settled ending in indented code → fallback (md-cache fuzz regression)", () => {
	// Standalone lex keeps the code token's trailing \n; full doc absorbs it → byte diff.
	assertFallback("    code\n\nPlain after.\n", "indented-code settled rejected");
	assertFallback("    indented code line\n\nPlain paragraph after indented code.\n\n", "fuzz-found case");
	// Last boundary lands right after an indented-code block → whole split falls back (KISS)
	assertFallback("para\n\n    code\n\nplain\n", "indented code before LAST boundary → fallback");
	// tab-expanded indentation counts (\t + space ≥ 4 columns)
	assertFallback("\t code\n\nplain\n", "tab-indented last settled line rejected");
});

test("B7 negative: settled ending in a normal line is unaffected", () => {
	assertSplit("para\n\nnext\n", "para\n", "plain settled untouched by B7");
	assertSplit("   three spaces ok\n\nnext\n", "   three spaces ok\n", "3-space line is not indented code");
	assertSplit("    ```\nx\n\npara\n", "    ```\nx\n", "settled ends with 'x' — B7 does not look deeper");
});

// ─── Group 4: weakened monotonicity ──────────────────────────────────────────

test("monotonicity (weakened): settled extends previous OR resets to ''", () => {
	const doc = "alpha beta gamma\n\ndelta epsilon\n\n# Head One\n\nzeta eta theta\n\nfinal line\n";
	let prev = "";
	for (let n = 1; n <= doc.length; n++) {
		const r = splitSettled(doc.slice(0, n));
		assert.ok(
			r.settled === "" || r.settled.startsWith(prev),
			`step ${n}: '${JSON.stringify(r.settled)}' must extend ${JSON.stringify(prev)} or be ''`,
		);
		assert.equal(r.settled + r.tail, doc.slice(0, n), `step ${n}: concat identity`);
		if (r.settled !== "") prev = r.settled;
	}
	assert.equal(prev, "alpha beta gamma\n\ndelta epsilon\n\n# Head One\n\nzeta eta theta\n");
});

test("monotonicity: hazard arriving mid-stream legitimately resets settled to '' (§3 item 12)", () => {
	const before = "para\n\nnext\n";
	assert.equal(splitSettled(before).settled, "para\n", "boundary valid at chunk N");
	const after = before + "\n[x]: /url\n"; // ']:' arrives at chunk N+1
	assertFallback(after, "def arrival resets settled");
});

test("streaming partial closing fence near boundary stays conservative (§3 item 12)", () => {
	// fence still open while closer is partial (`` is content, not a closer)
	assertFallback("intro\n\n```js\ncode\n``", "partial closer: fence open, no boundary usable");
	assertSplit("intro\n\n```js\ncode\n```\n\ndone\n", "intro\n\n```js\ncode\n```\n", "closed later");
});

// ─── Group 5: edge cases ──────────────────────────────────────────────────────

test("edge: empty / blank-only / single paragraph / fence-only", () => {
	assert.deepEqual(splitSettled(""), { settled: "", tail: "" }, "empty");
	assertFallback("\n\n\n", "blank-only text");
	assertFallback("just one paragraph\n", "single paragraph");
	assertFallback("```\ncode\n```\n", "fence-only (no blank+boundary after)");
});

test("edge: CRLF documents split at line starts, \\r stays with its line", () => {
	assertSplit("para\r\n\r\nnext\r\n", "para\r\n", "CRLF blank line + CRLF boundary");
	assertFallback("para\r\n\r\nnex", "CRLF + unfinished last line");
});

test("edge: concat identity holds on every input (incl. hazards and no-boundary)", () => {
	const inputs = [
		"", "x", "a\n\nb\n", "[x]: /u\n\nb\n", "```\nx\n", "\t- a\n\n\tb\n",
		"para\r\n\r\nnext\r\n", "п\n\nривет мир\n", "a\n\n# h\n\nb",
	];
	for (const t of inputs) {
		const r = splitSettled(t);
		assert.equal(r.settled + r.tail, t, `identity for ${JSON.stringify(t)}`);
	}
});

test("edge: tab normalization is analysis-only — original bytes preserved in output", () => {
	const text = "col\ta\n\nnext\n";
	const r = splitSettled(text);
	assert.equal(r.settled, "col\ta\n", "settled keeps original tab bytes");
	assert.equal(r.tail, "\nnext\n");
});
