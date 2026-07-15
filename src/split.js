/**
 * D1: pure function splitSettled(text) → {settled, tail}.
 * Conservative markdown split heuristic — rules H1-H4 + B1-B6 (PLAN.md Шаг 2,
 * fuzz-validated: 6576 checks, see research/ROUND2_review_1.md) + B7 (fuzz find).
 *
 * Contract:
 * - settled + tail === text (concatenation identity, always).
 * - settled ends with the \n of the last settled block; ALL blank separator
 *   lines belong to tail (inter-block spacing contract of pi's renderToken).
 * - Any hazard H1-H4 anywhere → {settled: "", tail: text} (full fallback).
 * - Tab normalization (\t → "   ", as the renderer does pre-lex) is applied
 *   internally for ANALYSIS only; boundaries are original-text offsets.
 * - Chooses the LAST safe boundary (maximize settled). Any doubt → settled "".
 * - B7: settled must not END with an indented-code line (≥4 spaces after tab
 *   expansion): lexed standalone, the code token keeps its trailing \n (extra
 *   styled empty line); in the full doc the following space token absorbs it.
 *   Such a boundary → full fallback (KISS: no rescan for an earlier boundary).
 *
 * ZERO imports — pure function.
 */

// H1: possible link-reference definition anywhere (defs are lexer-GLOBAL state;
// labels may span blank lines: `see it\n\n[foo\n\nbar]: /url`).
const H1_REF_DEF = /\]:/;
// H2: `<a ` sets lexer-global state.inLink, suppressing GFM autolinks in the
// tail (case-insensitive; leaks from headings/lists/blockquotes/tables).
// Tested against tab-normalized text, so `<a\t` is covered too.
const H2_A_TAG = /<a /i;
// H3: HTML block types 1-5 openers (≤3 spaces indent, outside closed fences) —
// these blocks span blank lines until their closer or EOF.
const H3_HTML_BLOCK = /^ {0,3}(?:<pre|<script|<style|<textarea|<!--|<\?|<!\[|<![a-z])/i;
// H4: lone \r without \n (marked normalizes CR on the *joined* text).
const H4_LONE_CR = /\r(?!\n)/;

const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,}) *$/; // empty info, trailing spaces ok
const BLANK_LINE = /^ *$/; // after \t→spaces expansion and \r strip
const ATX_HEADING = /^#{1,6}[ \t]/;
const ORDERED_MARKER = /^\d{1,9}[.)]/;
// B6: plain-paragraph starter must NOT be one of these first chars.
const REJECTED_STARTERS = "-+*>|<[#`~=_";

/** B6: L is an ATX heading or a restricted plain-paragraph starter. */
function isSafeStarter(line) {
	if (ATX_HEADING.test(line)) return true;
	if (REJECTED_STARTERS.includes(line[0])) return false;
	if (ORDERED_MARKER.test(line)) return false;
	return true;
}

/**
 * @param {string} text markdown source (possibly a growing stream prefix)
 * @returns {{settled: string, tail: string}} settled + tail === text
 */
export function splitSettled(text) {
	if (text === "") return { settled: "", tail: "" };
	const fallback = { settled: "", tail: text };

	// Global hazard scans (H1, H2, H4). H3 needs fence context → in the loop.
	if (H4_LONE_CR.test(text)) return fallback;
	if (H1_REF_DEF.test(text)) return fallback;
	if (H2_A_TAG.test(text.replace(/\t/g, "   "))) return fallback;

	let fence = null; // {char, len} while a fence is open
	let blankRunStart = -1; // original offset of the first blank line of the current run
	let sawNonBlank = false; // B2: prefix must contain non-blank content
	let boundary = -1; // original offset of the chosen split (start of blank run)

	let pos = 0;
	const n = text.length;
	while (pos < n) {
		const nl = text.indexOf("\n", pos);
		const complete = nl !== -1; // B4: line has its \n
		const rawLine = complete ? text.slice(pos, nl) : text.slice(pos);
		// Analysis view: strip \r (CRLF-aware), expand tabs like the renderer.
		const line = rawLine.replace(/\r$/, "").replace(/\t/g, "   ");

		if (BLANK_LINE.test(line)) {
			if (blankRunStart === -1) blankRunStart = pos; // B1: remember run start
		} else {
			// Candidate boundary at start of blank run before this line L, iff:
			// B1 (≥1 blank before, blank run entirely in tail), B2, B3 (no open
			// fence), B4 (L complete), B5 (col 0, non-space), B6 (safe starter).
			if (
				blankRunStart !== -1 &&
				sawNonBlank &&
				fence === null &&
				complete &&
				line[0] !== " " &&
				isSafeStarter(line)
			) {
				boundary = blankRunStart; // keep overwriting → LAST safe boundary
			}
			// Fence tracking + H3 (only outside fences: fence content is inert).
			if (fence !== null) {
				const m = line.match(FENCE_CLOSER);
				if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
			} else {
				if (H3_HTML_BLOCK.test(line)) return fallback;
				const m = line.match(FENCE_OPENER);
				// A backtick-fence info string may not contain ` (else: paragraph).
				if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
					fence = { char: m[1][0], len: m[1].length };
				}
			}
			sawNonBlank = true;
			blankRunStart = -1;
		}
		pos = complete ? nl + 1 : n;
	}

	if (boundary <= 0) return fallback;
	const settled = text.slice(0, boundary);
	// B7: reject a settled that ends with an indented-code line (see header).
	const lastNl = settled.lastIndexOf("\n", settled.length - 2);
	const lastLine = settled.slice(lastNl + 1).replace(/\r$/, "").replace(/\t/g, "   ");
	if (/^ {4}/.test(lastLine)) return fallback;
	return { settled, tail: text.slice(boundary) };
}
