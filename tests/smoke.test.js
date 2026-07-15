import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPiTui, loadTheme } from "./helpers.js";

test("pi-tui loads from pi installation and exposes Markdown", async () => {
	const tui = await loadPiTui();
	assert.equal(typeof tui.Markdown, "function", "Markdown class must exist");
	assert.equal(typeof tui.Markdown.prototype.render, "function", "Markdown.prototype.render must exist");
});

test("Markdown.render(80) returns a non-empty array of strings", async () => {
	const [tui, themeMod] = await Promise.all([loadPiTui(), loadTheme()]);
	const md = new tui.Markdown("# hi\n\ntext", 1, 0, themeMod.getMarkdownTheme());
	const lines = md.render(80);
	assert.ok(Array.isArray(lines), "render() must return an array");
	assert.ok(lines.length > 0, "render() must return at least one line");
	for (const line of lines) {
		assert.equal(typeof line, "string", "every rendered line must be a string");
	}
});

test("Intl.Segmenter exists and prototype.segment is patchable", () => {
	assert.equal(typeof Intl.Segmenter, "function", "Intl.Segmenter must exist");
	const desc = Object.getOwnPropertyDescriptor(Intl.Segmenter.prototype, "segment");
	assert.ok(desc, "segment descriptor must exist on prototype");
	assert.equal(desc.writable, true, "segment must be writable");
	assert.equal(desc.configurable, true, "segment must be configurable");
});
