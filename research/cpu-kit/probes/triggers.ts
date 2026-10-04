/** Кто просит перерисовку: таймеры, ввод, поток модели. */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("triggers");
  const origins: Record<string, number> = {};
  const screen = mod.TuiMainScreen.prototype;
  const orig = screen.doRender;
  screen.doRender = function (...a: any[]) {
    const stack = (new Error().stack ?? "").split("\n").slice(2, 8).map((s) => s.trim());
    const origin = stack.find((s) => /listOnTimeout|processTimers|Socket|Readable|emit|process\./.test(s)) ?? stack[1] ?? "?";
    const key = origin.replace(/^at\s+/, "").replace(/\s*\(.*$/, "").slice(0, 60);
    origins[key] = (origins[key] ?? 0) + 1;
    return orig.apply(this, a);
  };
  every(1500, () => save({ origins }));
}
