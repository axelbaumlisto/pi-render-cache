/**
 * The counters have to separate pi's renders from the extension's own canary —
 * conflating them is what made a dead patch look alive for six weeks.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { getStats, install, metricsLine, uninstall } from "../src/metrics.js";

function hosts() {
	class Markdown {
		render() {
			return [];
		}
	}
	class TuiMainScreen {
		doRender() {
			return "frame";
		}
		collectKittyImageIds() {
			return new Set();
		}
	}
	return { Markdown, TuiMainScreen };
}

test("counts frames and the share of them spent scanning for images", () => {
	const { Markdown, TuiMainScreen } = hosts();
	install({ TuiMainScreen, Markdown });
	const screen = new TuiMainScreen();

	screen.doRender();
	screen.collectKittyImageIds([]);

	const s = getStats();
	assert.equal(s.frames, 1);
	assert.ok(s.imageScanShare >= 0);
	uninstall();
});

test("a render triggered by our own canary is not credited to pi", () => {
	const { Markdown, TuiMainScreen } = hosts();
	install({ TuiMainScreen, Markdown });

	const canaryVerify = () => new Markdown().render();
	canaryVerify();
	new Markdown().render();

	const s = getStats();
	assert.equal(s.selfRenders, 1, "canary render leaked into the host count");
	assert.equal(s.hostRenders, 1);
	uninstall();
});

test("says outright when every render came from the self-check", () => {
	assert.match(metricsLine({ frames: 9, msPerFrame: 0.2, imageScanMs: 1, imageScanShare: 5, hostRenders: 0, selfRenders: 50 }), /NONE from pi/);
});

test("restores the host methods on uninstall", () => {
	const { Markdown, TuiMainScreen } = hosts();
	const before = TuiMainScreen.prototype.doRender;

	install({ TuiMainScreen, Markdown });
	assert.notEqual(TuiMainScreen.prototype.doRender, before);
	assert.equal(uninstall(), true);

	assert.equal(TuiMainScreen.prototype.doRender, before);
});
