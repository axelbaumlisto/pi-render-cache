/**
 * Regression: pi >= 1.0 constructs the assistant Markdown with an options
 * object carrying a `transform` callback:
 *
 *   new Markdown(text, outputPad, 0, theme, void 0,
 *                { transform: createMarkdownTransform("assistant", isStreaming, transformers) })
 *
 * Before this fix, md-cache's conservative gate treated ANY non-empty `options`
 * as non-cacheable, so every assistant render fell back and the cache never
 * engaged (observed as `/rcstats` → `md active ... h0/m0/f<N>` on pi 1.0.x,
 * even though the install-time canary passed because the canary builds Markdown
 * WITHOUT options).
 *
 * These tests pin the fix: a transform-only options object is cacheable (the
 * transform is applied first, so the split/cache operate on the same text the
 * original renderer uses), byte-equality holds, and any OTHER option still
 * falls back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPiTui, loadTheme } from "./helpers.js";

const tui = await loadPiTui();
const themeMod = await loadTheme();
const { Markdown, getCapabilities } = tui;

// Capture the pristine original BEFORE any install.
const origRender = Markdown.prototype.render;

const { install, uninstall, getStats } = await import("../src/md-cache.js");
const mdTheme = themeMod.getMarkdownTheme();

const WIDTHS = [20, 24, 47, 80];

const CORPUS = [
	"# Title\n\nIntro paragraph with **bold**, *italic*, `code`, ~~strike~~ and a [link](https://example.com).\n\n## Section two\n\nMore text follows here.\n",
	"Nested lists:\n\n- alpha\n- beta\n  - gamma\n    - epsilon\n- zeta\n\n1. one\n2. two\n\ndone\n",
	"Code:\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n\n```\nno lang\n```\n\ntail\n",
	"Русский текст в абзаце, довольно длинный, чтобы переноситься на узких ширинах.\n\nemoji: 🚀 🇹🇭 done\n\nfin\n",
	"para one\n\npara two\n\n\n\npara three after double blank run\n",
];

const identity = (text) => text;
// Non-identity but prefix-stable: the heading it rewrites lives in the settled
// prefix, so the split/stitch contract is preserved and the result must still be
// byte-identical to a single original render.
const bangHeading = (text) => text.replace(/^# (.+)$/m, "# $1!");

function renderWith(text, width, transform, theme = mdTheme) {
	return new Markdown(text, 1, 0, theme, undefined, { transform }).render(width);
}
function renderOrigWith(text, width, transform, theme = mdTheme) {
	return origRender.call(new Markdown(text, 1, 0, theme, undefined, { transform }), width);
}

test("I6-transform: a transform-only options object is cacheable (pi >= 1.0 call shape)", () => {
	install({ Markdown, getCapabilities });
	try {
		// (1) Identity transform — pi's real shape when no transformer is registered.
		for (const doc of CORPUS) {
			for (const w of WIDTHS) {
				const expected = renderOrigWith(doc, w, identity);
				// two fresh instances: miss pass then hit pass, like a streaming
				// updateContent cold-rebuild sequence.
				for (let pass = 0; pass < 2; pass++) {
					assert.deepEqual(
						renderWith(doc, w, identity),
						expected,
						`identity transform byte-equal [w=${w} pass=${pass}] ${JSON.stringify(doc.slice(0, 60))}`,
					);
				}
			}
		}
		const s = getStats();
		assert.ok(
			s.hits > 0 && s.misses > 0,
			`transform-only renders must exercise the cache path (hits ${s.hits}, misses ${s.misses}, fallbacks ${s.fallbacks})`,
		);
	} finally {
		uninstall();
	}
});

test("I6-transform: a non-identity transform stays byte-equal (self-verification guards it)", () => {
	// A dedicated theme object so a divergence-driven blacklist cannot poison mdTheme.
	const altTheme = { ...mdTheme };
	install({ Markdown, getCapabilities });
	try {
		for (const doc of CORPUS) {
			for (const w of [40, 80]) {
				assert.deepEqual(
					renderWith(doc, w, bangHeading, altTheme),
					renderOrigWith(doc, w, bangHeading, altTheme),
					`non-identity transform byte-equal [w=${w}]`,
				);
			}
		}
	} finally {
		uninstall();
	}
});

test("I6-transform: a transform alongside any other option still falls back", () => {
	install({ Markdown, getCapabilities });
	try {
		const doc = "# H\n\n1. one\n2. two\n\npara body\n";
		const cases = [
			["other-only", { preserveOrderedListMarkers: true }],
			["transform + other", { transform: identity, preserveOrderedListMarkers: true }],
		];
		for (const [name, options] of cases) {
			const f0 = getStats().fallbacks;
			assert.deepEqual(
				new Markdown(doc, 1, 0, mdTheme, undefined, options).render(80),
				origRender.call(new Markdown(doc, 1, 0, mdTheme, undefined, options), 80),
				`${name}: output === orig`,
			);
			assert.ok(getStats().fallbacks > f0, `${name}: fallback counter must grow`);
		}
	} finally {
		uninstall();
	}
});
