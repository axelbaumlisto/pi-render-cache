/**
 * pi 1.0.x passes a transform in options on every assistant message. Refusing
 * to cache anything with options meant the markdown cache stored nothing at
 * all: 72 renders in a resumed session, 72 fallbacks, zero hits.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { identify, install, getStats, uninstall } from "../src/md-cache.js";
import { loadPiTui, loadTheme } from "./helpers.js";

// The real host classes and the real theme: a hand-made theme misses the core
// keys the cache requires and every render falls back for the wrong reason.
const tui = await loadPiTui();
const themeMod = await loadTheme();

const host = () => tui.Markdown;
const theme = themeMod.getMarkdownTheme();
const setup = (Markdown) =>
  install({
    Markdown,
    getCapabilities: tui.getCapabilities,
    theme,
    budgetChars: 100_000,
  });

test("a transform no longer forces every render to the original", () => {
  const Markdown = host();
  setup(Markdown);
  const transform = () => {};

  const first = new Markdown(
    "# Заголовок\n\nтекст\n\nхвост",
    0,
    0,
    theme,
    null,
    { transform },
  );
  first.render(40);
  const second = new Markdown(
    "# Заголовок\n\nтекст\n\nхвост",
    0,
    0,
    theme,
    null,
    { transform },
  );
  second.render(40);

  const s = getStats();
  assert.equal(s.fallbacks, 0, "transform still fell back");
  assert.equal(s.hits, 1, "second identical render was not a cache hit");
  uninstall();
});

test("transforms with different sources never share a cache entry", () => {
  const Markdown = host();
  setup(Markdown);

  new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, {
    transform: (t) => t,
  }).render(40);
  new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, {
    transform: (t) => `${t} `,
  }).render(40);

  assert.equal(
    getStats().hits,
    0,
    "a different transform reused another one's lines",
  );
  uninstall();
});

test("two closures built from the same factory share an entry", () => {
  const Markdown = host();
  setup(Markdown);
  // pi makes one transform per message from a single factory: 69 distinct
  // objects, one source. Object identity would miss every single time.
  const factory = () => (t) => t;

  new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, {
    transform: factory(),
  }).render(40);
  new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, {
    transform: factory(),
  }).render(40);

  assert.equal(
    getStats().hits,
    1,
    "same-source transforms did not share an entry",
  );
  uninstall();
});

test("options we do not understand still go to the original", () => {
  const Markdown = host();
  setup(Markdown);

  new Markdown("# Заголовок\n\nтекст\n\nхвост", 0, 0, theme, null, {
    unknownOption: 1,
  }).render(40);

  assert.equal(getStats().fallbacks, 1);
  uninstall();
});

test("identify keys functions by source and other values by identity", () => {
  const a = (t) => t;
  const b = (t) => `${t} `;
  const sameSource = (t) => t;
  const objA = {};
  const objB = {};

  assert.equal(
    identify(a),
    identify(sameSource),
    "same source must share a key",
  );
  assert.notEqual(identify(a), identify(b));
  assert.equal(identify(objA), identify(objA));
  assert.notEqual(identify(objA), identify(objB));
});
