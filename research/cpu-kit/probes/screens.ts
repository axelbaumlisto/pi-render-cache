/** Какой экран реально перерисовывается и сколько раз. */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("screens");
  const counts: Record<string, { n: number; ms: number }> = {};
  for (const name of ["TuiMainScreen", "TuiAltScreen"]) {
    const proto: any = mod[name]?.prototype;
    if (!proto) continue;
    for (const method of ["doRender", "render", "requestRender", "renderOnce"]) {
      const d = Object.getOwnPropertyDescriptor(proto, method);
      if (!d || typeof d.value !== "function") continue;
      const orig = d.value, key = `${name}.${method}`;
      counts[key] = { n: 0, ms: 0 };
      proto[method] = function (...a: any[]) {
        const t = process.hrtime.bigint();
        try { return orig.apply(this, a); }
        finally { counts[key].n++; counts[key].ms += Number(process.hrtime.bigint() - t) / 1e6; }
      };
    }
  }
  every(1500, () => save({ counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(1) }])) }));
}
