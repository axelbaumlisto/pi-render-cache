/**
 * resolveLiveTuiModule: find the module pi's renderer actually runs from.
 *
 * pi 0.84.3 inlined the TUI into its own bundle, so the installed pi-tui
 * package became a copy nobody loads. The chunk is identified by what it
 * exports, because its name is content-hashed and changes every release.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLiveTuiModule } from "../scripts/resolve-pi.mjs";

function piRootWithChunks(chunks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc-live-mod-"));
  const dir = path.join(root, "dist", "bundle", "chunks");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(chunks))
    fs.writeFileSync(path.join(dir, name), source);
  return root;
}

const RENDERER = `
export class Markdown { render() { return []; } }
export function getCapabilities() { return {}; }
`;
const OTHER = `export const unrelated = 1;\n`;
const BROKEN = `import "./does-not-exist.js";\nexport const x = 1;\n`;

test("finds the chunk that exports the renderer, whatever it is called", async () => {
  const root = piRootWithChunks({
    "chunk-AAA.js": OTHER,
    "chunk-ZZZ.js": RENDERER,
  });

  const live = await resolveLiveTuiModule(root);

  assert.ok(live, "renderer chunk not found");
  assert.equal(path.basename(live.path), "chunk-ZZZ.js");
  assert.equal(typeof live.module.Markdown.prototype.render, "function");
  fs.rmSync(root, { recursive: true, force: true });
});

test("skips a chunk that cannot be imported on its own", async () => {
  const root = piRootWithChunks({
    "chunk-BROKEN.js": BROKEN,
    "chunk-GOOD.js": RENDERER,
  });

  const live = await resolveLiveTuiModule(root);

  assert.equal(path.basename(live.path), "chunk-GOOD.js");
  fs.rmSync(root, { recursive: true, force: true });
});

test("ignores a chunk that exports a Markdown without a render method", async () => {
  const root = piRootWithChunks({
    "chunk-DECOY.js":
      "export class Markdown {}\nexport function getCapabilities() {}\n",
  });

  assert.equal(await resolveLiveTuiModule(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("returns null for a layout with no bundle, where the package is the renderer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc-no-bundle-"));

  assert.equal(await resolveLiveTuiModule(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});
