// Regression: md-cache must find the markdown theme through the host package,
// because pi's managed install (>=1.0.1) puts a shell launcher on PATH and the
// package under ~/.pi/agent/install/releases/<version>/node_modules/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../extensions/index.ts", import.meta.url)),
  "utf8",
);

test("the theme is taken from the host package before any filesystem walk", () => {
  const hostImport = src.indexOf(
    'await import("@earendil-works/pi-coding-agent")',
  );
  const pathWalk = src.indexOf("resolvePiRoot()");
  assert.ok(hostImport > 0, "host package import is present");
  assert.ok(pathWalk > hostImport, "the filesystem walk is only the fallback");
});

test("host and path branches share one theme adapter", () => {
  assert.equal(
    (src.match(/function themeFrom\(/g) ?? []).length,
    1,
    "one adapter",
  );
  assert.equal(
    (src.match(/themeFrom\(/g) ?? []).length,
    3,
    "declared once, used by both branches",
  );
  assert.match(
    src,
    /initTheme/,
    "an uninitialized theme is still initialized once",
  );
});
