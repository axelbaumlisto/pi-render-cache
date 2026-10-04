/**
 * Прототип: кеш отрисовки, переживающий кадр.
 *
 * pi создаёт renderCache заново в каждом renderLayoutFrame, поэтому всё дерево
 * рисуется с нуля на каждый кадр: в большой сессии 200-400 отрисовок на кадр
 * против 24 в новой. Сигнала «я изменился» у компонентов нет (invalidate идёт
 * только вниз, dirty/revision в коде отсутствуют), поэтому ключом служит
 * дешёвая подпись содержимого: у листьев — их текст, у контейнеров — подписи
 * детей.
 *
 * KIT_XFRAME=0 — замер без кеша, для сравнения.
 */
import { every, liveTui, writer } from "./resolve.mjs";

const MODE = process.env.KIT_XFRAME ?? "all"; // off | leaves | all
const ON = MODE !== "off" && MODE !== "0";
const LEAVES_ONLY = MODE === "leaves";

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h;
}

export default async function () {
  const { mod } = await liveTui();
  const save = writer("xframe");
  const lineCache = new WeakMap<object, { width: number; sig: number; lines: string[] }>();
  let frames = 0, frameNs = 0n, calls = 0, hits = 0, sigNs = 0n, checked = 0;
  const stale: Record<string, number> = {};

  /** Дешёвая подпись: во что компонент превратится, не считая переносов строк. */
  const signature = (c: any, depth = 0): number => {
    if (!c || depth > 24) return 0;
    const kids = Array.isArray(c.children) ? c.children : null;
    if (kids) {
      let h = 5381 ^ kids.length;
      for (const kid of kids) h = ((h << 5) + h + signature(kid, depth + 1)) | 0;
      return h;
    }
    // лист: текст известен либо полем, либо геттером
    const text = typeof c.text === "string" ? c.text
      : typeof c.getText === "function" ? String(c.getText())
      : typeof c.content === "string" ? c.content
      : null;
    if (text === null) return -1; // неизвестный лист → не кешируем
    return hash(text) ^ (c.paddingX ?? 0) ^ ((c.paddingY ?? 0) << 8);
  };

  const screen = mod.TuiMainScreen.prototype;
  const origFrame = screen.doRender;
  screen.doRender = function (...a: any[]) {
    const t = process.hrtime.bigint();
    try { return origFrame.apply(this, a); } finally { frames++; frameNs += process.hrtime.bigint() - t; }
  };

  if (ON) {
    for (const key of Object.keys(mod)) {
      const C: any = mod[key];
      const d = typeof C === "function" && Object.getOwnPropertyDescriptor(C.prototype ?? {}, "render");
      if (!d || typeof d.value !== "function") continue;
      const orig = d.value;
      C.prototype.render = function (width: number, ...rest: any[]) {
        calls++;
        const t0 = process.hrtime.bigint();
        const isContainer = Array.isArray((this as any).children);
        if (LEAVES_ONLY && isContainer) return orig.call(this, width, ...rest);
        const sig = signature(this);
        sigNs += process.hrtime.bigint() - t0;
        if (sig === -1) return orig.call(this, width, ...rest);
        const hit = lineCache.get(this);
        if (hit && hit.width === width && hit.sig === sig) {
          hits++;
          // Подпись — догадка: она не видит ни курсора, ни выделения, ни кадра
          // анимации. Поэтому каждое N-е попадание сверяется с настоящей
          // отрисовкой, и расхождения считаются поимённо.
          if (hits % 7 === 0) {
            checked++;
            const fresh = orig.call(this, width, ...rest);
            const same = fresh.length === hit.lines.length && fresh.every((l: string, i: number) => l === hit.lines[i]);
            if (!same) {
              stale[key] = (stale[key] ?? 0) + 1;
              lineCache.set(this, { width, sig, lines: fresh });
              return fresh;
            }
          }
          return hit.lines;
        }
        const lines = orig.call(this, width, ...rest);
        lineCache.set(this, { width, sig, lines });
        return lines;
      };
    }
  }

  every(1500, () => save({
    mode: MODE, frames,
    msPerFrame: +(frames ? Number(frameNs) / 1e6 / frames : 0).toFixed(2),
    calls, hits, hitRate: +(calls ? (100 * hits) / calls : 0).toFixed(1),
    signatureMs: +(Number(sigNs) / 1e6).toFixed(1),
    checked, stale,
  }));
}
