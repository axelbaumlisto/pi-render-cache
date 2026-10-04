#!/usr/bin/env node
/**
 * Does the patch reach the renderer of a real session?
 *
 * Everything else in this repo exercises the patch in isolation — the
 * benchmarks import the TUI package and measure the patched prototype. That is
 * what let the extension keep passing while being a no-op for six weeks: pi
 * 0.84.3 moved the renderer into its own bundle, the package copy stopped being
 * loaded, and nothing here noticed.
 *
 * So this runs pi for real, in a pty, with an extension that counts calls on
 * the prototype the extension patches, and fails when the count is zero.
 *
 * Usage: node scripts/verify-live.mjs [--prompt "..."] [--seconds 40]
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const PROMPT = flag("prompt", "Напиши три абзаца про кэширование, со списком и **жирным**");
const SECONDS = Number(flag("seconds", 40));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-live-"));
const log = path.join(dir, "calls.log");
const probe = path.join(dir, "probe.ts");

const piBin = (() => {
	try {
		return fs.realpathSync(execFileSync("sh", ["-lc", "command -v pi"], { encoding: "utf8" }).trim());
	} catch {
		return null;
	}
})();
if (!piBin) {
	console.error("pi не найден в PATH — живую проверку выполнить нельзя");
	process.exit(2);
}
const piRoot = piBin.replace(/\/dist\/.*$/, "");

fs.writeFileSync(
	probe,
	`import * as fs from "fs";
import { resolveLiveTuiModule, resolvePiRoot } from ${JSON.stringify(path.resolve("scripts/resolve-pi.mjs"))};
export default async function () {
	try {
		const live = await resolveLiveTuiModule(resolvePiRoot().root);
		const mod: any = live ? live.module : await import("@earendil-works/pi-tui");
		const where = live ? live.path.split("/").pop() : "package";
		let calls = 0;
		const orig = mod.Markdown.prototype.render;
		mod.Markdown.prototype.render = function (...a: any[]) { calls++; return orig.apply(this, a); };
		const timer = setInterval(() => fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ calls, where })), 2000);
		(timer as any).unref?.();
	} catch (e: any) {
		fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ error: String(e?.message ?? e) }));
	}
}
`,
);

// A real pty, a real terminal size: an 80x24 default renders so little that a
// broken patch can still look busy.
const runner = path.join(dir, "run.sh");
fs.writeFileSync(runner, `stty rows 50 cols 160 2>/dev/null\nexec "${piBin}" -e "${probe}"\n`);

const driver = `printf '%s\\n' ${JSON.stringify(PROMPT)}; sleep ${SECONDS}; printf '\\003'; sleep 1; printf '\\003'; sleep 1`;
spawnSync("sh", ["-lc", `(${driver}) | script -q /dev/null sh ${runner} > /dev/null 2>&1`], {
	timeout: (SECONDS + 30) * 1000,
});

let result = {};
try {
	result = JSON.parse(fs.readFileSync(log, "utf8"));
} catch {
	console.error("проба ничего не записала — сессия не запустилась");
	process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });

if (result.error) {
	console.error(`проба не смогла пропатчить рендерер: ${result.error}`);
	process.exit(1);
}
console.log(`патч стоит на: ${result.where}`);
console.log(`вызовов Markdown.render за сессию: ${result.calls}`);
if (!result.calls) {
	console.error("НОЛЬ вызовов — патч не доходит до рендера живой сессии");
	process.exit(1);
}
console.log("PASS: патч работает в настоящей сессии");
