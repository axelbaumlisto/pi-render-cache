/**
 * Ограничитель частоты кадров.
 *
 * pi перерисовывает экран не чаще, чем раз в MIN_RENDER_INTERVAL_MS (по
 * умолчанию 16 мс = до 60 кадров в секунду). Поле статическое и читается по
 * ссылке на базовый класс, поэтому до него добираемся через прототип
 * TuiMainScreen. KIT_THROTTLE задаёт новое значение в миллисекундах.
 */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("throttle");
  const base: any = Object.getPrototypeOf(mod.TuiMainScreen);
  const was = base?.MIN_RENDER_INTERVAL_MS;
  const want = Number(process.env.KIT_THROTTLE ?? "0");
  if (want > 0 && typeof was === "number") base.MIN_RENDER_INTERVAL_MS = want;

  const counts: Record<string, { n: number; ms: number }> = {};
  for (const name of ["TuiMainScreen", "TuiAltScreen"]) {
    const proto: any = mod[name]?.prototype;
    const d = proto && Object.getOwnPropertyDescriptor(proto, "doRender");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value; counts[name] = { n: 0, ms: 0 };
    proto.doRender = function (...a: any[]) {
      const t = process.hrtime.bigint();
      try { return orig.apply(this, a); }
      finally { counts[name].n++; counts[name].ms += Number(process.hrtime.bigint() - t) / 1e6; }
    };
  }
  every(1500, () => save({
    throttleWas: was, throttleNow: base?.MIN_RENDER_INTERVAL_MS,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(0) }])),
  }));
}
