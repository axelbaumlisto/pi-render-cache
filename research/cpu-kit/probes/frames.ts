/** Сколько стоит кадр и куда внутри него уходит время. */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod, file } = await liveTui();
  const screen = mod.TuiMainScreen.prototype;
  const save = writer("frames");
  let frames = 0, frameNs = 0n, imageNs = 0n;
  const origFrame = screen.doRender;
  screen.doRender = function (...a: any[]) {
    const t = process.hrtime.bigint();
    try { return origFrame.apply(this, a); } finally { frames++; frameNs += process.hrtime.bigint() - t; }
  };
  for (const name of ["collectKittyImageIds", "expandChangedRangeForKittyImages", "applyLineResets"]) {
    const orig = screen[name];
    if (typeof orig !== "function") continue;
    screen[name] = function (...a: any[]) {
      const t = process.hrtime.bigint();
      try { return orig.apply(this, a); } finally { imageNs += process.hrtime.bigint() - t; }
    };
  }
  every(1500, () => {
    const frameMs = Number(frameNs) / 1e6, imageMs = Number(imageNs) / 1e6;
    save({ chunk: file, frames, frameMs: +frameMs.toFixed(1),
      msPerFrame: +(frames ? frameMs / frames : 0).toFixed(2),
      imageScanMs: +imageMs.toFixed(1),
      imageScanShare: +(frameMs ? (100 * imageMs) / frameMs : 0).toFixed(1),
      cpuUserSec: +(process.cpuUsage().user / 1e6).toFixed(1),
      rssMb: Math.round(process.memoryUsage().rss / 1048576) });
  });
}
