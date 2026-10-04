/** Своё время каждого класса компонента (без вложенных вызовов). */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("classes");
  const stat: Record<string, { n: number; self: bigint }> = {};
  let nested = 0n;
  for (const key of Object.keys(mod)) {
    const C: any = mod[key];
    const d = typeof C === "function" && Object.getOwnPropertyDescriptor(C.prototype ?? {}, "render");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value;
    stat[key] = { n: 0, self: 0n };
    C.prototype.render = function (...a: any[]) {
      const start = process.hrtime.bigint();
      const before = nested;
      try { return orig.apply(this, a); }
      finally {
        const total = process.hrtime.bigint() - start;
        stat[key].n++;
        stat[key].self += total - (nested - before);
        nested = before + total;
      }
    };
  }
  every(1500, () => save({ classes: Object.fromEntries(Object.entries(stat)
    .filter(([, v]) => v.n > 0)
    .map(([k, v]) => [k, { calls: v.n, selfMs: +(Number(v.self) / 1e6).toFixed(1) }])) }));
}
