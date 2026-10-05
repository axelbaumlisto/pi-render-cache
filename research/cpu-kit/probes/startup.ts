/** Во что обходится запуск: до первого кадра и сколько отрисовок он требует. */
import * as fs from "fs";
import { every, liveTui, writer } from "./resolve.mjs";

/**
 * Процессорное время всего дерева, а не только этого процесса: pi порождает
 * npm и прочее, и их время видно лишь в cutime/cstime родителя, причём только
 * после того, как они завершены и собраны.
 */
function treeCpuSec(): number | null {
  try {
    const parts = fs.readFileSync("/proc/self/stat", "utf8").split(")").pop()!.trim().split(/\s+/);
    const hz = 100; // SC_CLK_TCK на Linux и Termux
    const [utime, stime, cutime, cstime] = [parts[11], parts[12], parts[13], parts[14]].map(Number);
    return +((utime + stime + cutime + cstime) / hz).toFixed(1);
  } catch {
    return null; // macOS: /proc нет
  }
}

export default async function () {
  const { mod } = await liveTui();
  const save = writer("startup");
  let renders = 0, firstFrameAt = 0, rendersBeforeFirstFrame = 0, cpuAtFirstFrame = 0, frames = 0;
  for (const key of Object.keys(mod)) {
    const C: any = mod[key];
    const d = typeof C === "function" && Object.getOwnPropertyDescriptor(C.prototype ?? {}, "render");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value;
    C.prototype.render = function (...a: any[]) { renders++; return orig.apply(this, a); };
  }
  const screen = mod.TuiMainScreen.prototype;
  const origFrame = screen.doRender;
  screen.doRender = function (...a: any[]) {
    if (!firstFrameAt) {
      firstFrameAt = +process.uptime().toFixed(2);
      rendersBeforeFirstFrame = renders;
      cpuAtFirstFrame = +(process.cpuUsage().user / 1e6).toFixed(1);
    }
    frames++;
    return origFrame.apply(this, a);
  };
  every(1000, () => save({
    firstFrameAt, rendersBeforeFirstFrame, cpuAtFirstFrame,
    frames, renders,
    uptime: +process.uptime().toFixed(1),
    cpuUserSec: +(process.cpuUsage().user / 1e6).toFixed(1),
    treeCpuSec: treeCpuSec(),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  }));
}
