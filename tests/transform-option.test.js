/**
 * pi 1.0.x passes a transform in options on every assistant message. Refusing
 * to cache anything with options meant the markdown cache stored nothing at
 * all: 72 renders in a resumed session, 72 fallbacks, zero hits.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { identify, install, getStats, uninstall } from "../src/md-cache.js";
import { loadPiTui, loadTheme } from "./helpers.js";

// The real host classes and the real theme: a hand-made theme misses the core
// keys the cache requires and every render falls back for the wrong reason.
const tui = await loadPiTui();
const themeMod = await loadTheme();

const host = () => tui.Markdown;
const theme = themeMod.getMarkdownTheme();
const setup = (Markdown) =>
	install({ Markdown, getCapabilities: tui.getCapabilities, theme, budgetChars: 100_000 });

test("a transform no longer forces every render to the original", () => {
	const Markdown = host();
	setup(Markdown);
	const transform = () => {};

	const first = new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, { transform });
	first.render(40);
	const second = new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, { transform });
	second.render(40);

	const s = getStats();
	assert.equal(s.fallbacks, 0, "transform still fell back");
	assert.equal(s.hits, 1, "second identical render was not a cache hit");
	uninstall();
});

test("two different transforms never share a cache entry", () => {
	const Markdown = host();
	setup(Markdown);

	new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, { transform: () => {} }).render(40);
	new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, { transform: () => {} }).render(40);

	assert.equal(getStats().hits, 0, "a different transform reused another one's lines");
	uninstall();
});

test("options we do not understand still go to the original", () => {
	const Markdown = host();
	setup(Markdown);

	new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, { unknownOption: 1 }).render(40);

	assert.equal(getStats().fallbacks, 1);
	uninstall();
});

test("identify is stable per object and distinct across objects", () => {
	const a = () => {};
	const b = () => {};

	assert.equal(identify(a), identify(a));
	assert.notEqual(identify(a), identify(b));
});
