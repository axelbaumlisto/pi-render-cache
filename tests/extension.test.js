/**
 * Extension-level behavior tests (PLAN.md Шаг 4). Plain JS — the .ts extension
 * itself is transpiled by pi's jiti at runtime; here we test the UNDERLYING
 * contracts it relies on: restore-only-if-ours (monkey-patch etiquette,
 * ROUND2_review_2.md §4) and version-drift hash stability across reinstall.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPiTui, loadTheme } from "./helpers.js";

const tui = await loadPiTui();
await loadTheme(); // ensure global theme initialized (md render path)
const { Markdown, getCapabilities } = tui;

const segMod = await import("../src/seg-cache.js");
const mdMod = await import("../src/md-cache.js");

const MD_STATE_KEY = Symbol.for("render-cache:md:v1");

test("restore-only-if-ours (seg-cache): foreign wrapper on top survives uninstall", () => {
	const native = Intl.Segmenter.prototype.segment;
	segMod.install();
	const ours = Intl.Segmenter.prototype.segment;
	assert.notEqual(ours, native, "install must patch");
	// A second extension wraps on top of us.
	const foreign = function segment(str) {
		return ours.call(this, str);
	};
	Intl.Segmenter.prototype.segment = foreign;
	try {
		segMod.uninstall();
		assert.equal(
			Intl.Segmenter.prototype.segment,
			foreign,
			"uninstall must NOT restore over a foreign wrapper",
		);
	} finally {
		Intl.Segmenter.prototype.segment = native; // manual cleanup
	}
	assert.equal(globalThis[Symbol.for("render-cache:seg:v1")], undefined, "state dropped anyway");
});

test("restore-only-if-ours (md-cache): foreign wrapper on top survives uninstall", () => {
	const orig = Markdown.prototype.render;
	mdMod.install({ Markdown, getCapabilities });
	const ours = Markdown.prototype.render;
	assert.notEqual(ours, orig, "install must patch");
	const foreign = function render(width) {
		return ours.call(this, width);
	};
	Markdown.prototype.render = foreign;
	try {
		mdMod.uninstall();
		assert.equal(Markdown.prototype.render, foreign, "uninstall must NOT restore over a foreign wrapper");
	} finally {
		Markdown.prototype.render = orig; // manual cleanup
	}
	assert.equal(globalThis[MD_STATE_KEY], undefined, "state dropped anyway");
});

test("version-drift: origHash stored at first install is stable across reinstall", () => {
	const orig = Markdown.prototype.render;
	mdMod.install({ Markdown, getCapabilities });
	try {
		const state = globalThis[MD_STATE_KEY];
		const hash1 = state.origHash;
		assert.equal(typeof hash1, "string", "hash stored at first install");
		assert.ok(hash1.length > 0, "hash non-empty");
		mdMod.install({ Markdown, getCapabilities }); // /reload re-runs the factory
		assert.equal(globalThis[MD_STATE_KEY], state, "reinstall adopts the same state");
		assert.equal(globalThis[MD_STATE_KEY].origHash, hash1, "origHash survives reinstall unchanged");
		// djb2 of the pristine original matches what the extension recomputes for its drift check
		let h = 5381;
		const s = state.orig.toString();
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
		assert.equal(h.toString(16), hash1, "origHash === djb2(orig.toString())");
	} finally {
		mdMod.uninstall();
	}
	assert.equal(Markdown.prototype.render, orig, "clean uninstall restores the original");
});

test("version-drift scenario: state present + prototype replaced by unknown fn → detectable", () => {
	mdMod.install({ Markdown, getCapabilities });
	const state = globalThis[MD_STATE_KEY];
	const ours = Markdown.prototype.render;
	const alien = function render(_width) {
		return ["alien"];
	};
	Markdown.prototype.render = alien;
	try {
		// The extension's guard condition: not ours AND toString-hash ≠ origHash.
		let h = 5381;
		const s = Markdown.prototype.render.toString();
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
		const drifted = Markdown.prototype.render !== state.patched && h.toString(16) !== state.origHash;
		assert.equal(drifted, true, "guard must flag an alien render as drift");
	} finally {
		Markdown.prototype.render = ours;
		mdMod.uninstall();
	}
});
