/** Из каких компонентов pi собирает экран (что добавляется в контейнеры). */
import { every, liveTui, writer } from "./resolve.mjs";

export default async function () {
  const { mod } = await liveTui();
  const save = writer("children");
  const counts: Record<string, number> = {};
  let patched = 0;
  for (const key of Object.keys(mod)) {
    const proto: any = typeof mod[key] === "function" ? (mod[key] as any).prototype : null;
    const d = proto && Object.getOwnPropertyDescriptor(proto, "addChild");
    if (!d || typeof d.value !== "function") continue;
    const orig = d.value; patched++;
    proto.addChild = function (child: any, ...rest: any[]) {
      const k = `${key} <- ${child?.constructor?.name ?? "?"}`;
      counts[k] = (counts[k] ?? 0) + 1;
      return orig.call(this, child, ...rest);
    };
  }
  every(1500, () => save({ containersPatched: patched, counts }));
}
