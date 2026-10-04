/** /rcstats must distinguish "patch installed" from "patch used". */
import { strict as assert } from "node:assert";
import test from "node:test";
import { reachLine } from "../src/stats.js";

test("names the module that was patched and the call count", () => {
  const line = reachLine("bundle:chunk-6FX7UEPL.js", {
    hits: 40,
    misses: 9,
    fallbacks: 1,
  });

  assert.equal(line, "patched bundle:chunk-6FX7UEPL.js | 50 calls");
});

test("says so outright when the renderer never called the patch", () => {
  const line = reachLine("package", { hits: 0, misses: 0, fallbacks: 0 });

  assert.match(line, /NOT REACHING THE RENDERER \(0 calls\)/);
});
