/** Сколько работы уходит в сегментацию графем (вторая половина issue #6665). */
import { every, writer } from "./resolve.mjs";

export default async function () {
  const save = writer("segmenter");
  let calls = 0, chars = 0, ns = 0n;
  const orig = Intl.Segmenter.prototype.segment;
  Intl.Segmenter.prototype.segment = function (input: string) {
    const t = process.hrtime.bigint();
    try { return orig.call(this, input); }
    finally { calls++; chars += input?.length ?? 0; ns += process.hrtime.bigint() - t; }
  };
  every(1500, () => save({ calls, chars, ms: +(Number(ns) / 1e6).toFixed(1) }));
}
