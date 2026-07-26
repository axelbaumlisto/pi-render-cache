#!/usr/bin/env node
/**
 * Upstream compatibility check for the selected pi installation.
 *
 * Uses scripts/resolve-pi.mjs (honors PI_PACKAGE_ROOT) to select ONE pi root
 * and its pi-tui, then reports environment/versions/realpaths/hashes and runs:
 *   - structural checks: Markdown.prototype.render patchable,
 *     Intl.Segmenter.prototype.segment writable+configurable;
 *   - behavioral canaries: Markdown render returns non-empty string[];
 *     seg-cache patched-vs-pristine differential (byte-equal) on a tiny corpus;
 *   - diagnostic (non-gating) signature checks against compatibility.json.
 *
 * Exit 0 when supported, nonzero otherwise.
 *
 * Flags:
 *   --json               stdout is JSON ONLY (human output goes to stderr)
 *   --update-allowlist   write the observed implementation hashes for the
 *                        selected pi version into compatibility.json
 *                        (populate command, run per supported version:
 *                         node scripts/check-upstream.mjs --update-allowlist)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashString } from "../src/md-cache.js";
import { resolvePiRoot, resolvePiTui, resolveThemeModule } from "./resolve-pi.mjs";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPAT_PATH = path.join(PROJECT_ROOT, "compatibility.json");

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const UPDATE_ALLOWLIST = args.includes("--update-allowlist");

/** Human output: stderr in --json mode, stdout otherwise. */
function say(line) {
	if (JSON_MODE) process.stderr.write(line + "\n");
	else process.stdout.write(line + "\n");
}

const report = {
	supported: false,
	node: process.version,
	icu: process.versions.icu ?? null,
	platform: process.platform,
	arch: process.arch,
	pi: null,
	piTui: null,
	theme: null,
	hashes: {},
	checks: [],
	diagnostics: [],
};

function check(name, ok, detail) {
	report.checks.push({ name, ok, detail });
	say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	return ok;
}

function diagnostic(name, ok, detail) {
	report.diagnostics.push({ name, ok, detail });
	say(`${ok ? "ok  " : "warn"}  [diagnostic] ${name}${detail ? ` — ${detail}` : ""}`);
}

let failed = false;
try {
	// --- Resolve the compatibility unit ---
	const pi = resolvePiRoot();
	const tui = resolvePiTui(pi.root);
	const theme = resolveThemeModule(pi.root);
	report.pi = { version: pi.version, root: pi.root, source: pi.source };
	report.piTui = { version: tui.version, root: tui.root, entry: tui.entry };
	report.theme = { path: theme.path };

	say(`pi        ${pi.version}  (${pi.source})  ${pi.root}`);
	say(`pi-tui    ${tui.version}  ${tui.root}`);
	say(`theme     ${theme.path}`);
	say(`node      ${process.version}  icu ${report.icu}  ${process.platform}/${process.arch}`);

	// --- Load modules from the selected root ---
	const tuiMod = await import(pathToFileURL(tui.entry).href);
	const themeMod = await import(pathToFileURL(theme.path).href);
	const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
	if (!globalThis[THEME_KEY]) themeMod.initTheme("dark");

	// --- Structural checks ---
	const { Markdown } = tuiMod;
	failed |= !check(
		"Markdown.prototype.render exists and is patchable",
		typeof Markdown === "function" &&
			typeof Markdown.prototype.render === "function" &&
			(Object.getOwnPropertyDescriptor(Markdown.prototype, "render")?.writable ?? false) &&
			(Object.getOwnPropertyDescriptor(Markdown.prototype, "render")?.configurable ?? false),
	);
	const segDesc = Object.getOwnPropertyDescriptor(Intl.Segmenter?.prototype ?? {}, "segment");
	failed |= !check(
		"Intl.Segmenter.prototype.segment exists writable+configurable",
		typeof Intl.Segmenter === "function" && !!segDesc && segDesc.writable && segDesc.configurable,
	);

	// --- Source hashes ---
	const renderSrc = Markdown?.prototype?.render?.toString() ?? "";
	report.hashes.markdownRender = { djb2: hashString(renderSrc) };
	if (typeof themeMod.getMarkdownTheme === "function") {
		report.hashes.getMarkdownTheme = { djb2: hashString(themeMod.getMarkdownTheme.toString()) };
	}
	say(`hash      Markdown.prototype.render djb2=${report.hashes.markdownRender.djb2}`);
	if (report.hashes.getMarkdownTheme) {
		say(`hash      getMarkdownTheme djb2=${report.hashes.getMarkdownTheme.djb2}`);
	}

	// --- Behavioral canary: Markdown render ---
	let mdTheme = null;
	try {
		mdTheme = themeMod.getMarkdownTheme();
		const lines = new Markdown("# x\n\ntext", 1, 0, mdTheme).render(80);
		failed |= !check(
			"Markdown canary render(80) returns non-empty string[]",
			Array.isArray(lines) && lines.length > 0 && lines.every((l) => typeof l === "string"),
		);
	} catch (err) {
		failed |= !check("Markdown canary render(80) returns non-empty string[]", false, String(err));
	}

	// --- Behavioral canary: seg-cache differential (patched vs pristine, byte-equal) ---
	try {
		const segCache = await import(pathToFileURL(path.join(PROJECT_ROOT, "src", "seg-cache.js")).href);
		const corpus = ["hello world", "日本語テキスト", "héllo wörld — ẍ", "e\u0301e\u0301", "👨‍👩‍👧‍👦 emoji"];
		const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
		const pristine = corpus.map((s) => [...seg.segment(s)].map((r) => r.segment).join("\u0000"));
		segCache.install();
		try {
			let equal = true;
			for (let pass = 0; pass < 2 && equal; pass++) {
				// pass 0 = miss path, pass 1 = hit path
				const patched = corpus.map((s) => [...seg.segment(s)].map((r) => r.segment).join("\u0000"));
				equal = patched.length === pristine.length && patched.every((v, i) => v === pristine[i]);
			}
			failed |= !check("seg-cache differential canary byte-equal (miss+hit passes)", equal);
		} finally {
			segCache.uninstall();
		}
	} catch (err) {
		failed |= !check("seg-cache differential canary byte-equal (miss+hit passes)", false, String(err));
	}

	// --- Diagnostic signature checks against compatibility.json (non-gating) ---
	let compat = null;
	try {
		compat = JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"));
	} catch {
		diagnostic("compatibility.json readable", false, COMPAT_PATH);
	}
	if (compat) {
		const entry = compat.versions?.[pi.version];
		diagnostic(
			`pi ${pi.version} listed in compatibility.json`,
			!!entry,
			entry ? `pi-tui expected ${entry.piTui}` : "unlisted version — diagnostic only",
		);
		if (entry) {
			diagnostic(
				"pi-tui version matches compatibility entry",
				entry.piTui === tui.version,
				`expected ${entry.piTui}, got ${tui.version}`,
			);
			const allow = compat.implementationHashes?.[pi.version];
			if (allow && Object.keys(allow).length > 0) {
				diagnostic(
					"Markdown.prototype.render hash matches allowlist",
					allow.markdownRender === report.hashes.markdownRender.djb2,
					`allowlist ${allow.markdownRender}, observed ${report.hashes.markdownRender.djb2}`,
				);
				if (report.hashes.getMarkdownTheme) {
					diagnostic(
						"getMarkdownTheme hash matches allowlist",
						allow.getMarkdownTheme === report.hashes.getMarkdownTheme.djb2,
						`allowlist ${allow.getMarkdownTheme}, observed ${report.hashes.getMarkdownTheme.djb2}`,
					);
				}
			} else {
				diagnostic(
					"implementation hash allowlist populated",
					false,
					"empty — run: node scripts/check-upstream.mjs --update-allowlist",
				);
			}
		}
		if (UPDATE_ALLOWLIST) {
			compat.implementationHashes ??= {};
			compat.implementationHashes[pi.version] = {
				markdownRender: report.hashes.markdownRender.djb2,
				...(report.hashes.getMarkdownTheme
					? { getMarkdownTheme: report.hashes.getMarkdownTheme.djb2 }
					: {}),
			};
			fs.writeFileSync(COMPAT_PATH, JSON.stringify(compat, null, "\t") + "\n");
			say(`allowlist updated for pi ${pi.version} in ${COMPAT_PATH}`);
		}
	}
} catch (err) {
	failed = true;
	report.checks.push({ name: "resolve pi compatibility unit", ok: false, detail: String(err?.message ?? err) });
	say(`FAIL  resolve pi compatibility unit — ${err?.message ?? err}`);
}

report.supported = !failed;
say(report.supported ? "SUPPORTED" : "UNSUPPORTED");
if (JSON_MODE) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(report.supported ? 0 : 1);
