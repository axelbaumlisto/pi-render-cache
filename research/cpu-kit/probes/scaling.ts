/** Кадры и отрисовки за кадр — чтобы увидеть зависимость от размера истории. */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("scaling");
  let frames = 0, frameNs = 0n, renders = 0, renderNs = 0n;
  const perClass: Record<string, number> = {};
  const screen = mod.TuiMainScreen.prototype;
  const origFrame = screen.doRender;
  screen.doRender = function (...a: any[]) {
    const t = process.hrtime.bigint();
    try { return origFrame.apply(this, a); } finally { frames++; frameNs += process.hrtime.bigint() - t; }
  };
  let depth = 0;
  for (const key of Object.keys(mod)) {
    const C: any = mod[key];
    const d = typeof C === "function" && Object.getOwnPropertyDescriptor(C.prototype ?? {}, "render");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value;
    C.prototype.render = function (...a: any[]) {
      renders++; perClass[key] = (perClass[key] ?? 0) + 1;
      const top = depth++ === 0;
      const t = top ? process.hrtime.bigint() : 0n;
      try { return orig.apply(this, a); }
      finally { depth--; if (top) renderNs += process.hrtime.bigint() - t; }
    };
  }
  every(1500, () => save({
    frames, msPerFrame: +(frames ? Number(frameNs) / 1e6 / frames : 0).toFixed(2),
    renders, rendersPerFrame: +(frames ? renders / frames : 0).toFixed(0),
    renderMs: +(Number(renderNs) / 1e6).toFixed(1),
    top: Object.fromEntries(Object.entries(perClass).sort((a, b) => b[1] - a[1]).slice(0, 4)),
  }));
}
