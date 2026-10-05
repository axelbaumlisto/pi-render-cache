/** Сколько компонентов pi материализует на сессию и сколько это стоит. */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("tree");
  const byClass: Record<string, number> = {};
  let total = 0;
  for (const key of Object.keys(mod)) {
    const proto: any = typeof mod[key] === "function" ? (mod[key] as any).prototype : null;
    const d = proto && Object.getOwnPropertyDescriptor(proto, "addChild");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value;
    proto.addChild = function (child: any, ...rest: any[]) {
      total++;
      const n = child?.constructor?.name ?? "?";
      byClass[n] = (byClass[n] ?? 0) + 1;
      return orig.call(this, child, ...rest);
    };
  }
  const started = Date.now();
  every(1500, () => save({
    components: total,
    seconds: +((Date.now() - started) / 1000).toFixed(0),
    cpuUserSec: +(process.cpuUsage().user / 1e6).toFixed(1),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    byClass: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 5)),
  }));
}
