/**
 * Найти модуль, из которого pi реально рисует.
 *
 * С версии 0.84.3 pi вшивает свой TUI в собственный бандл, поэтому пакет
 * @earendil-works/pi-tui, лежащий рядом, никто не грузит — патч в нём не
 * действует (проверено счётчиком: 0 вызовов против 50 через чанк). Чанки
 * названы по хешу содержимого и меняются каждый релиз, поэтому нужный ищется
 * по экспортам, а не по имени.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function piRoot() {
	if (process.env.PI_PACKAGE_ROOT) return process.env.PI_PACKAGE_ROOT;
	const bin = fs.realpathSync(execFileSync("sh", ["-lc", "command -v pi"], { encoding: "utf8" }).trim());
	if (bin.includes("/dist/")) return bin.replace(/\/dist\/.*$/, "");
	// managed install: launcher в ~/.pi/agent/bin
	const agentDir = path.join(process.env.HOME ?? "", ".pi", "agent");
	const version = fs.readFileSync(path.join(agentDir, "install", "current-version"), "utf8").trim();
	return path.join(agentDir, "install", "releases", version, "node_modules", "@earendil-works", "pi-coding-agent");
}

export async function liveTui(root = piRoot()) {
	const dir = path.join(root, "dist", "bundle", "chunks");
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".js")) continue;
		try {
			const mod = await import(pathToFileURL(path.join(dir, file)).href);
			if (typeof mod?.TuiMainScreen?.prototype?.doRender === "function") return { mod, file };
		} catch {}
	}
	throw new Error("чанк с TuiMainScreen не найден");
}

export function writer(name) {
	const out = process.env.KIT_OUT ?? `/tmp/kit-${name}.json`;
	return (data) => {
		try {
			fs.writeFileSync(out, JSON.stringify({ probe: name, ...data }));
		} catch {}
	};
}

export function every(ms, fn) {
	const t = setInterval(fn, ms);
	t.unref?.();
	process.on("exit", fn);
	return t;
}
