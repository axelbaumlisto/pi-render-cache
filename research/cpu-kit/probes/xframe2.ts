/**
 * Межкадровый кеш отрисовки с инвалидацией по изменениям.
 *
 * Прошлая попытка ключевала по «подписи содержимого» и врала: контейнеры
 * зависят от состояния, которого в подписи нет. Здесь иначе — кеш сбрасывается,
 * когда дерево реально меняют: addChild, removeChild, clear, invalidate,
 * setText. Классы, у которых есть собственное состояние (прокрутка, курсор,
 * выделение), не кешируются вовсе.
 *
 * KIT_XF2=off — выключить. Каждое седьмое попадание сверяется с настоящей
 * отрисовкой, расхождения считаются поимённо.
 */
import { every, liveTui, writer } from "./resolve.mjs";

const SKIP = new Set(["ScrollView", "Editor", "SelectList", "Input", "Loader", "CancellableLoader", "TuiMainScreen", "TuiAltScreen"]);

/**
 * Контейнер не имеет собственного текста: его вывод — это вывод детей. Если
 * хоть один ребёнок пересчитался заново, запись контейнера недействительна,
 * даже когда поколение не менялось: ребёнок мог зависеть от геттера, который
 * вернул другое значение (счётчик времени, имя сессии, индикатор работы).
 * Поэтому у контейнера ключ — набор ссылок на массивы строк его детей.
 */
function childLinesKey(component: any, cache: WeakMap<object, { lines: string[] }>): string | null {
  const kids = component?.children;
  if (!Array.isArray(kids)) return null;
  const ids: string[] = [];
  for (const kid of kids) {
    const entry = cache.get(kid);
    if (!entry) return null;
    ids.push(String(entry.lines.length));
  }
  return ids.join(",");
}

export default async function () {
  const { mod } = await liveTui();
  const save = writer("xframe2");
  const on = process.env.KIT_XF2 !== "off";
  let generation = 0;
  const cache = new WeakMap<object, { gen: number; width: number; lines: string[]; kids?: string | null }>();
  let calls = 0, hits = 0, checked = 0;
  const stale: Record<string, number> = {};

  const bump = () => { generation++; };
  for (const key of Object.keys(mod)) {
    const C: any = mod[key];
    const proto = typeof C === "function" ? C.prototype : null;
    if (!proto) continue;
    for (const m of ["addChild", "removeChild", "clear", "invalidate", "setText", "setContent"]) {
      const d = Object.getOwnPropertyDescriptor(proto, m);
      if (!d || typeof d.value !== "function") continue;
      const orig = d.value;
      proto[m] = function (...a: any[]) { bump(); return orig.apply(this, a); };
    }
  }

  if (on) {
    for (const key of Object.keys(mod)) {
      const C: any = mod[key];
      const d = typeof C === "function" && Object.getOwnPropertyDescriptor(C.prototype ?? {}, "render");
      if (!d || typeof d.value !== "function" || SKIP.has(key)) continue;
      const orig = d.value;
      C.prototype.render = function (width: number, ...rest: any[]) {
        calls++;
        const hit = cache.get(this);
        const container = Array.isArray((this as any).children);
        if (container && hit) {
          // сначала пересчитываем детей, иначе сверять не с чем
          for (const kid of (this as any).children) {
            if (typeof kid?.render === "function") kid.render(width);
          }
        }
        const kidsKey = container ? childLinesKey(this, cache as any) : "";
        if (hit && hit.gen === generation && hit.width === width && (hit as any).kids === kidsKey) {
          hits++;
          if (hits % 7 === 0) {
            checked++;
            const fresh = orig.call(this, width, ...rest);
            const same = fresh.length === hit.lines.length && fresh.every((l: string, i: number) => l === hit.lines[i]);
            if (!same) { stale[key] = (stale[key] ?? 0) + 1; cache.set(this, { gen: generation, width, lines: fresh, kids: kidsKey } as any); return fresh; }
          }
          return hit.lines;
        }
        const lines = orig.call(this, width, ...rest);
        cache.set(this, { gen: generation, width, lines, kids: kidsKey } as any);
        return lines;
      };
    }
  }

  const screen = mod.TuiMainScreen.prototype;
  const altProto = mod.TuiAltScreen?.prototype;
  let frames = 0, frameMs = 0;
  for (const proto of [screen, altProto].filter(Boolean)) {
    const orig = (proto as any).doRender;
    if (typeof orig !== "function") continue;
    (proto as any).doRender = function (...a: any[]) {
      const t = process.hrtime.bigint();
      try { return orig.apply(this, a); } finally { frames++; frameMs += Number(process.hrtime.bigint() - t) / 1e6; }
    };
  }
  every(1500, () => save({
    enabled: on, generation, frames, frameMs: +frameMs.toFixed(0),
    calls, hits, hitRate: +(calls ? (100 * hits) / calls : 0).toFixed(1),
    checked, stale,
  }));
}
