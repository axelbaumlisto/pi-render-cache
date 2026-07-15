# ROUND 2 Review — markdown-parsing specialist: splitSettled() vs marked 18.0.5 lexer semantics

Reviewer scope: does `lexer(prefix) + lexer(tail) == lexer(full)` hold at the plan's proposed
"safe" boundaries (blank line + next block starts with `#`-heading or plain paragraph), and what
is the minimal boundary rule set that guarantees I1?

Method: read the plan; read the ACTUAL renderer
(`pi-tui/dist/components/markdown.js` — `Marked()` instance with default GFM,
`StrictStrikethroughTokenizer` for `del`, `trimPartialClosingFences` on last token, tab→3-space
pre-lex normalization, per-render fresh `Lexer` state) and the installed **marked 18.0.5** lexer
source (`marked.esm.js`). Then executed ~110 targeted differential probes plus a ~6,900-check
randomized fuzz **against the real `Markdown.render()`** with a byte-visible marker theme.
Probe scripts: `/tmp/segcache-review/probe{,2,3,4,5,6,7}.mjs`, `fuzz.mjs` (kept for reproduction;
no project/source files touched).

---

## 1. Breaking constructs found (all reproduced against the real renderer)

Every item below is a case where the split point **satisfies the plan's stated rule**
("blank line, then `#`-heading or plain paragraph") or a nearby legal-looking variant, yet
`render(prefix) ++ render(tail) !== render(full)` byte-for-byte.

### 1.1 Reference link definitions — lexer-GLOBAL state (`this.tokens.links`)

Defs registered anywhere in the document resolve usages anywhere else (both directions,
case-insensitive). The plan knows about the trivial case; the non-trivial variants it misses:

| # | Input (`⇑` = split point, valid per plan's rule) | Failure |
|---|---|---|
| a | `[ref]: https://x.com\n\n⇑see [ref] please` | tail renders `[ref]` literal instead of OSC-8 hyperlink |
| b | `see [ref] please\n\n⇑[ref]: https://x.com` | prefix renders literal; full renders link. Also prefix-alone render of a lone def emits an extra `""` line (def→space token) → even line COUNT differs |
| c | **def inside blockquote**: `> [x]: /url\n> quote\n\n⇑see [x] here` — nested `blockTokens` still writes into the shared `tokens.links` | BREAK |
| d | **def inside list item**: `- [x]: /url\n\n⇑see [x] here` | BREAK |
| e | **case-insensitive**: `[Foo]: /url\n\n⇑use [FOO] here` | BREAK |
| f | collapsed reflink `[foo][]` and **image reflink** `![alt][x]` with def in tail | BREAK |
| g | def with **title on the next line** `[x]: /url\n    "title"` | BREAK |
| h | "footnote" `[^1]: note` — marked core has NO footnotes; it lexes as a **def with label `^1`**, and `text[^1]` resolves as a reflink | BREAK |

**Killer variant — def label spanning the boundary itself.** marked 18's def label
(`U=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/`) may contain newlines **including a blank line**:

```
see it\n\n[foo\n\n⇑bar]: /url
```

`lexer(full)` = single `def` token spanning the blank line; the tail `bar]: /url` **starts with a
plain paragraph char 'b'** — passes the plan's boundary test — and output diverges (verified).
So "next block looks like a plain paragraph" can NOT be decided line-locally when `]:` exists
anywhere in the text.

Defs also affect **emphasis parsing** indirectly: `inlineTokens()` masks `[label]` spans via
`reflinkSearch` before running `emStrong`, so a def's existence can change bold/italic
tokenization of *other* paragraphs.

### 1.2 HTML blocks types 1–5 span blank lines (prefix token swallows the tail)

CommonMark HTML block types 1 (`<pre|script|style|textarea`), 2 (`<!--`), 3 (`<?`),
4 (`<!X`), 5 (`<![CDATA[`) end only at their closer, **not** at blank lines. marked 18
implements this (`ze` regex, `…(?:</\1>[^\n]*\n+|$)` / `…(?:-->|$)` etc.) — an *unclosed*
opener swallows everything to EOF, including the "settled" boundary:

```
<pre>\nraw stuff\n\n⇑# Heading\n\nafter     → full: heading is raw HTML text; split: styled heading  BREAK
<!-- note\n\n⇑# Heading                     → BREAK
<script>\nx=1\n\n⇑# Heading                 → BREAK   (same: <style>, <textarea>, <?, <!X, <![CDATA[)
<pre>\nraw\n\n⇑some *emph* text             → BREAK even for a paragraph tail (emphasis styled vs raw)
```

Note: with an all-plain paragraph tail the bytes happen to coincide (raw HTML render ≈ plain
paragraph render), which makes this class **easy to miss in a small corpus** — it breaks the
moment the tail contains any inline styling, heading, list, link, etc.
Types 6/7 (`<div>` …) end at blank lines → safe (verified).

### 1.3 Inline `state.inLink` from an unbalanced `<a ` tag suppresses GFM autolinks in the tail

marked's inline tokenizer sets `lexer.state.inLink=true` on `<a ` (regex `/^<a /i`) and only
clears it on `</a>`. The GFM `url()` tokenizer is gated by `!state.inLink`. State persists
across the whole `inlineQueue` — i.e., across blocks, including **into the tail**:

```
click <a href="x">here\n\n⇑visit www.example.com   → full: plain text; split: hyperlink  BREAK
x <a href="u">y\n\n⇑write foo@bar.com               → BREAK (email autolink)
hi <A HREF="x">y\n\n⇑visit www.example.com          → BREAK (case-insensitive!)
```

Verified: leak happens from `<a ` inside paragraphs, **headings, list items, blockquotes and
table cells** (nested lexing shares the same lexer state). `<a>` without a space does NOT set
the flag; balanced `<a …>…</a>` is safe; `<a href>` inside a closed fence is safe.
(`state.inRawBlock` from inline `<pre>` also leaks but is provably invisible in this renderer —
`escaped` is unused by pi's renderToken — verified OK.)

### 1.4 List continuation & retro-mutation after a blank line

A blank line does NOT terminate a list if the next line is indented or another bullet:

| Input | Failure |
|---|---|
| `- a\n- b\n\n⇑- c` | full = ONE loose list (blank lines between items); split = tight list + tight list. Line count differs |
| `- a\n- b\n\n⇑  cont` (2-space tail) | continuation of item `b` + **retro-flips the whole list to loose** (blank inserted between a and b) |
| `- item\n\n⇑    code?` (4-space tail) | full: plain continuation text inside the item; split: fenced-code-styled block. Grossly different |
| `- a\n  - b\n\n⇑    cont` | continuation of the nested item vs indented code block |
| `- ` + long text `\n\n⇑  tail…` at width 24 | even the "same-looking" 2-space continuation wraps at `itemWidth = width−2` vs full width → different wrap points |
| `- w w w…\n\n⇑   t t t…` (3-space) at width 20 | ditto — **any** leading-whitespace tail after a list breaks at narrow widths even when it "passed" at 80 |

Consequence: "plain paragraph" must mean **column-0, no leading space/tab** — and since the
renderer rewrites `\t`→3 spaces *before* lexing, the splitter must apply the same tab
normalization before classifying (a tab-indented tail after a list = 3-space continuation).

### 1.5 Indented code blocks absorb blank lines

`    code1\n\n⇑    code2` → full: ONE code block with an embedded empty line; split: two code
blocks. (Rejected automatically by the column-0 requirement, but must be in the corpus.)

### 1.6 Blank-run handling / degenerate prefixes

- **Split mid-blank-run**: `para\n\n⇑\n\nnext` → extra blank line in concat. The boundary must
  consume the ENTIRE blank run into the prefix.
- **Blank-only prefix**: `\n\n⇑para` → prefix renders `[]` (early-return for whitespace-only
  text) but full render keeps a leading `""` line from the space token. Prefix must contain
  non-blank content.
- **Split between `\r` and `\n`**: `para\r ⇑ \nnext` → marked normalizes `\r\n`/`\r`→`\n` on the
  *joined* text but each half separately here yields an extra line. Splitter must be CRLF-aware
  (or fall back when a lone `\r` exists).
- **Split at a non-line-start / mid-token** (e.g. after `` `` `` of a partial closing fence):
  breaks `trimPartialClosingFences` equivalence. Boundaries must be at line starts only.

### 1.7 Open fences (plan already covers — confirmed mandatory)

`` ```\ncode\n\n⇑not code? `` → tail rendered outside the fence. The plan's fence tracking is
necessary; note the tracker must be real, not a naive toggle: opener/closer **char must match**,
closer length ≥ opener length (` ```` ` is not closed by ` ``` `), closer must have empty info
string, up-to-3-space indentation allowed, and a backtick-fence opener may not contain `` ` `` in
its info string (`` ``` `x `` is a paragraph). All verified. False-"open" inside list items
(`  ``` ` at 2-space indent) is harmless for correctness (only skips boundaries); fences inside
blockquotes/list items that stay unclosed do NOT leak past a blank+col0 boundary (verified OK).

### 1.8 Constructs verified SAFE at (corrected) boundaries — no action needed

Setext headings cannot cross a blank line (underline must be adjacent — verified); blockquote
lazy continuation cannot cross a blank; paragraph lazy continuation cannot cross a blank;
emphasis/del/codespan never span blocks (inline scope is per inline-queue entry); tables cannot
acquire their delimiter row across a blank; `~~~`-vs-` ``` ` interactions fine with a correct
tracker; hr, task lists, autolinks `<…>` (not gated by inLink), `1979. year` paragraphs
(4+ digit "bullets" aren't bullets, but `\d{1,9}[.)]` are), closed type-1 HTML, `<div>` blocks,
front-matter (marked core has none — `---` at doc start is just hr/setext and prefix always
starts at offset 0), CRLF at proper boundaries, blank lines containing spaces/tabs, hard breaks
at prefix end, `#hashtag` (no space → paragraph, but reject anyway), 3-space-indented ATX
headings in the tail (`   # H` — legal heading; simpler to reject with the col0-nonspace rule?
No: `   #` passes "col0 non-space"? It does NOT — leading spaces → reject; full render treats it
as heading either way and the probe passed, but rejecting indented tails loses nothing).

---

## 2. Verdict on the proposed boundary rule + corrected rule

**The plan's rule as written ("blank line, then `#`-heading or plain paragraph; doubt ⇒
settled=''") is NOT sufficient.** Concretely it admits every failure in §1.1 (def label spanning
the blank line — the tail literally *is* a plain-paragraph-looking line), §1.2 (heading/paragraph
tail after an unclosed `<pre>`/`<!--`/`<script>`), §1.3 (`<a ` inLink leak into a
heading/paragraph tail), §1.4 (a "plain paragraph" with 1–4 leading spaces after a list), and
§1.6 (blank-run/CRLF/degenerate-prefix bugs) — unless "doubt" is formalized into exactly the
checks below. The good news: every failure class is detectable by cheap line scans, and the
plan's `ref-links → fallback` instinct already covers the biggest class if implemented as a
raw-text scan.

### Corrected minimal SAFE rule set (validated: 110 targeted probes + 6,576 fuzz checks + 297 streaming-sim checks, 0 failures)

**Normalization first.** Run the splitter on the same text the renderer lexes: apply
`\t → "   "` (renderer does this pre-lex) and treat `\r\n`/`\r` as line breaks the way marked
does; if a lone `\r` exists, either handle it exactly or fall back.

**Global hazard scans → `settled = ""` (whole-text fallback):**

- H1. Text contains `]:` anywhere → possible link-reference def (covers usages/defs across the
  boundary in either direction, defs inside blockquotes/lists, multiline and blank-line-spanning
  labels, `[^1]:` pseudo-footnotes, emStrong masking side-effects). Refinement (optional, for
  hit-rate): ignore `]:` inside closed fenced code regions.
- H2. Text contains `/<a[ \t\n]/i`-ish opener — conservative: `/<a /i` (that is what sets
  `state.inLink`); safe to broaden. Refinement: only when unbalanced w.r.t. `</a>`.
- H3. Any line (outside closed fences) starting with ≤3 spaces then `<pre|<script|<style|<textarea|<!--|<?|<![A-Z]|<![CDATA[` (tags case-insensitive) → HTML block types 1–5 may span blanks; conservative: presence ⇒ fallback. Refinement: only if unclosed before the candidate boundary.
- H4. Lone `\r` (not `\r\n`) present → fallback (or implement exact `\r`→`\n` semantics).

**Boundary predicate** — position `B` = start of line `L` is a safe split iff:

- B1. `L` is the first non-blank line after ≥1 blank line (`/^[ \t]*$/` counts as blank), and the
  **entire blank run is inside the prefix**.
- B2. `text[0..B)` contains at least one non-blank character.
- B3. No fence (```` ``` ````/`~~~`, with the char/length/info/indent rules of §1.7) is open at B.
- B4. `L` is **complete** (has its `\n`, or streaming has confirmed the line ended) — otherwise a
  growing first char `1` can turn into `1. bullet`, `-` into a bullet, etc.
- B5. `L` starts at **column 0 with a non-space, non-tab character** (kills all list/nested-list
  continuation and indented-code absorption, incl. wrap-width divergence).
- B6. `L` matches `^#{1,6}[ \t]` (ATX heading), **or** is a "plain paragraph starter": first char
  not in `- + * > | < [ # \` ~ = _` and not a `\d{1,9}[.)]` bullet prefix. (Several of those
  rejections are belt-and-braces — e.g. `=` can't be a setext underline across a blank — but
  each is cheap and removes a proof obligation.)

Prefix cache key must include: prefix text, width, theme identity, `paddingX`,
`options.preserveOrderedListMarkers`, `options.preserveBackslashEscapes`, presence/value of
`defaultTextStyle` (plan already falls back on it — keep that), and note that
`getCapabilities().hyperlinks` is process-global — if it can flip mid-process, key or re-check it.

### Is "monotonic prefix growth" achievable?

**Not as specified in Шаг 2 test 4.** With a hazard-scan fallback, a def (`]:`) or `<a ` arriving
mid-stream at chunk *N* legitimately collapses `settled` from `"…"` to `""` — `split(text2).settled`
does **not** start with `split(text1).settled`. Correctness (I1/I5) survives because fallback is
the identity path, but the monotonicity test must be weakened to:
`split(text2).settled` **either** extends `split(text1).settled` **or** equals `""` (hazard
fallback). Absent hazards, monotonicity holds: tail content cannot invalidate an accepted
boundary (B4 fixes the first tail line's class once complete; everything else the tail does is
rendered by the original renderer as one piece), confirmed by the 297-step streaming simulation.

---

## 3. Test corpus additions the plan MUST include

Every entry below is a reproduced BREAK (or a guard for one) and must be in `split.test.js` /
`md-cache.test.js` (I1 corpus), at widths **[20, 24, 47, 80]** (narrow widths expose the
list-continuation wrap divergence that width 80 hides):

1. `[ref]: /url\n\nsee [ref]` and the reverse order (def↔usage across boundary, both directions).
2. `see it\n\n[foo\n\nbar]: /url` — **def label containing a blank line spanning the boundary**
   (the tail looks like a plain paragraph; this is the case that kills any purely line-local rule).
3. `> [x]: /url\n> q\n\nsee [x]` and `- [x]: /url\n\nsee [x]` — defs inside blockquote/list.
4. `[Foo]: /url\n\nuse [FOO]` — case-insensitive resolution; `see [foo][]\n\n[foo]: /url`;
   `![alt][x]\n\n[x]: /pic.png`; `[x]: /url\n    "title"` (title on next line);
   `[x]: /url (title)` (paren title); `text[^1]\n\n[^1]: note` (pseudo-footnote = def).
5. `# see [x]\n\n[x]: /url` and a table cell `| [x] |` with def in tail (usage inside
   heading/table + def across boundary — also exercises table column-width divergence).
6. Unclosed HTML types 1–5 in prefix with **heading tail** and with **styled-paragraph tail**:
   `<pre>`, `<script>`, `<style>`, `<textarea>`, `<!--`, `<?`, `<!X`, `<![CDATA[` — each as
   `X\nraw\n\n# Heading` and `X\nraw\n\nsome *emph* text`. Plus closed counterparts (must NOT
   fall back / must stay byte-identical).
7. inLink leaks: `click <a href="x">here\n\nvisit www.example.com`; same with email
   `foo@bar.com` tail; `<A HREF=…>` uppercase; `<a ` inside heading / list item / blockquote /
   table cell; balanced `<a…>…</a>` (safe, no fallback); `<a>` w/o space (safe); `<a href>`
   inside a fence (safe).
8. List continuation: `- a\n- b\n\n- c` (loose merge); `- a\n- b\n\n  cont` (retro-loose flip);
   `- item\n\n    code?` (4-space); `- a\n  - b\n\n    cont` (nested); the 2-space and 3-space
   continuation cases at width ≤24; tab-indented tail after a list (`\tcont` — 3 spaces after
   normalization); `1. a\n\n2. b` ordered merge; `- a\n\n\n- b` (double blank still one loose list).
9. `    code1\n\n    code2` (indented code absorbing the blank).
10. Blank-run pathology: split mid-run (`para\n\n ⇑ \n\nnext`), blank-only prefix (`\n\n ⇑ para`),
    blanks containing spaces/tabs, prefix `para\r ⇑ \nnext` (CRLF split), lone-`\r` documents.
11. Fence tracker: ` ```` `-opened/` ``` `-"closed" (still open); `` ``` `x `` info-string with
    backtick (not a fence); `~~~ foo` non-closing tilde line; closer with trailing spaces;
    closer longer than opener; unclosed fence inside list item / blockquote followed by
    blank + col0 paragraph and blank + heading (all must stay identical); open-fence split
    (must be rejected by splitter).
12. Partial closing fence (`` `` `` streaming) near the boundary — `trimPartialClosingFences`
    equivalence; and the streaming def-arrival scenario: boundary valid at chunk N, `]:`
    arrives at chunk N+1 ⇒ settled resets to `""` and output still matches (weakened
    monotonicity assertion from §2).
13. Fuzz harness (recommended, cheap): random concatenations of ~20 fragment types × all rule-
    accepted boundaries × widths {20,47,80}, byte-diff vs full render — this run: 6,576 checks
    0 failures with the corrected rule; keep it as a regression gate for pi/marked upgrades.

---

## 4. Verdict

**CONDITIONAL GO — maturity 6/10.**

- The architecture is sound and the "correct by construction via conservative split + I1 diff
  corpus" philosophy is exactly right; the fence-state tracking and ref-link fallback instincts
  are correct.
- But the boundary rule **as written in the plan admits at least five reproduced breaking
  classes** (§1.1–§1.6), two of which (unclosed-HTML with plain tail; list continuation at
  width 80) produce byte-identical output *in small/wide corpora* and would sail through the
  plan's current Шаг-2/Шаг-3 test lists unnoticed — the corpus in §3 is therefore not optional.
- Шаг 2's monotonicity test (test 4) is unsatisfiable as stated and must be weakened to
  "extends OR resets to empty" (§2).
- Conditions for GO: adopt the corrected rule set (H1–H4, B1–B6), add the §3 corpus + fuzz gate,
  fix the monotonicity spec, and extend the cache key per §2 (paddingX, options, theme identity,
  hyperlink capability). With those, I1 held over every probe and ~6,900 randomized checks in
  this review.
- Residual risk: marked upgrades can add new cross-block state (as `checkbox` tokens and def-
  label semantics changed in recent majors); the fuzz gate + I1 corpus re-run on pi upgrade
  (already planned) is the right mitigation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task completed without widening scope: read plan + actual pi-tui markdown.js renderer + marked 18.0.5 lexer source; ran ~110 targeted differential probes and a ~6,900-check fuzz against the real Markdown.render(); wrote the audit to the authoritative path /tmp/segcache-review/ROUND2_review_1.md. No project/source files modified; probe scripts written only under /tmp/segcache-review/."
    }
  ],
  "changedFiles": [
    "/tmp/segcache-review/ROUND2_review_1.md",
    "/tmp/segcache-review/probe.mjs (scratch probe, /tmp only)",
    "/tmp/segcache-review/probe2.mjs (scratch)",
    "/tmp/segcache-review/probe3.mjs (scratch)",
    "/tmp/segcache-review/probe4.mjs (scratch)",
    "/tmp/segcache-review/probe5.mjs (scratch)",
    "/tmp/segcache-review/probe6.mjs (scratch)",
    "/tmp/segcache-review/probe7.mjs (scratch)",
    "/tmp/segcache-review/fuzz.mjs (scratch)"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node /tmp/segcache-review/probe.mjs .. probe7.mjs",
      "result": "passed",
      "summary": "~110 differential checks against real renderer; found breaking classes: ref-defs (incl. blank-line-spanning labels, defs in bq/list, case-insens, collapsed/img reflinks, footnote-style), unclosed HTML types 1-5 spanning blanks, <a inLink autolink suppression leak, list continuation/loose-flip after blank (incl. narrow-width wrap divergence), indented-code blank absorption, blank-run/CRLF/degenerate-prefix splits"
    },
    {
      "command": "node /tmp/segcache-review/fuzz.mjs",
      "result": "passed",
      "summary": "corrected rule (H1-H4 + B1-B6): 6576 boundary checks + 297 streaming-sim checks, 0 byte-diff failures"
    }
  ],
  "validationOutput": [
    "fuzz: 6576 checks, 0 failures; stream: 297 checks, 0 failures (with corrected boundary rule)",
    "plan's rule as written: >=15 reproduced BREAK cases (see report sections 1.1-1.6)"
  ],
  "residualRisks": [
    "marked major upgrades may introduce new cross-block lexer state; mitigated by I1 corpus + fuzz gate on upgrade",
    "fuzz corpus is fragment-based, not fully adversarial; targeted probes cover the known CommonMark spanning constructs"
  ],
  "noStagedFiles": true,
  "diffSummary": "Wrote audit report to /tmp/segcache-review/ROUND2_review_1.md; scratch probe scripts in /tmp/segcache-review/. No repository or pi installation files touched.",
  "reviewFindings": [
    "blocker: plan's boundary rule admits def-label-spanning-blank-line case ([foo\\n\\nbar]: /url) where tail looks like a plain paragraph — line-local classification is impossible; requires global ']:' scan fallback",
    "blocker: unclosed HTML block types 1-5 (<pre>,<script>,<style>,<textarea>,<!--,<?,<!X,<![CDATA[) span blank lines and swallow rule-accepted heading/paragraph tails",
    "blocker: inline '<a ' sets lexer-global state.inLink which suppresses GFM url/email autolinks in the tail (case-insensitive; leaks from headings/lists/blockquotes/tables)",
    "blocker: 'plain paragraph' must mean column-0 non-whitespace after tab normalization — leading-space tails after lists diverge (loose-flip, itemWidth wrap at narrow widths, 4-space=code-in-item)",
    "major: Шаг 2 monotonicity test unsatisfiable as stated — must allow settled reset to empty on hazard arrival",
    "major: cache key must include paddingX, both options flags, theme identity, hyperlink capability",
    "verdict: CONDITIONAL GO, maturity 6/10"
  ],
  "manualNotes": "Corrected rule validated empirically against the actual renderer: hazard scans (]:, /<a /i, HTML-block starters, lone \\r) force settled='' ; boundaries only at start of first non-blank line after a fully-consumed blank run, prefix non-blank, no open fence (char/length/info-aware tracker), first tail line complete, col0 non-space, ATX-heading-or-restricted-plain-starter. Probe/fuzz scripts kept in /tmp/segcache-review/ for the parent to rerun."
}
```
