/**
 * What the host actually does, counted in the session you are really using.
 *
 * Every scripted measurement in this repo turned out to measure something
 * else: the replay harness measured the patch in isolation, and a pty driven
 * by a script renders three to seven frames a minute, where nothing costs
 * anything. The one session that showed real cost — 17% of a core, 40% of it
 * walking lines looking for image headers — was a person working in a real
 * terminal, and that cannot be reproduced from a script.
 *
 * So the counters live here and run while you work. /rcstats reads them out.
 * Optimise what they show, not what a benchmark imagines.
 */
const counters = {
  frames: 0,
  frameNs: 0n,
  imageScanNs: 0n,
  hostRenders: 0,
  selfRenders: 0,
};
let installed = null;

const CANARY = "canaryVerify";

/** Did this render come from pi, or from our own patch checking itself? */
function fromHost() {
  const stack = new Error().stack ?? "";
  return !stack.includes(CANARY);
}

/**
 * @param {{TuiMainScreen: Function, Markdown: Function}} opts
 * @returns {{state: "active"|"unsupported", reason: string|null}}
 */
export function install({ TuiMainScreen, Markdown }) {
  const screen = TuiMainScreen?.prototype;
  if (typeof screen?.doRender !== "function") {
    return { state: "unsupported", reason: "doRender absent" };
  }
  if (installed) return { state: "active", reason: null };

  const origFrame = screen.doRender;
  const patchedFrame = function (...args) {
    const t = process.hrtime.bigint();
    try {
      return origFrame.apply(this, args);
    } finally {
      counters.frames++;
      counters.frameNs += process.hrtime.bigint() - t;
    }
  };
  screen.doRender = patchedFrame;

  const scans = [];
  for (const name of [
    "collectKittyImageIds",
    "expandChangedRangeForKittyImages",
    "applyLineResets",
  ]) {
    const orig = screen[name];
    if (typeof orig !== "function") continue;
    const patched = function (...args) {
      const t = process.hrtime.bigint();
      try {
        return orig.apply(this, args);
      } finally {
        counters.imageScanNs += process.hrtime.bigint() - t;
      }
    };
    screen[name] = patched;
    scans.push({ name, orig, patched });
  }

  // Counting renders separately from the md-cache's own hit/miss numbers is
  // the only way to tell a live patch from one that only ever answers its own
  // canary — which is exactly how this extension looked healthy while dead.
  const origRender = Markdown?.prototype?.render;
  let patchedRender = null;
  if (typeof origRender === "function") {
    patchedRender = function (...args) {
      if (fromHost()) counters.hostRenders++;
      else counters.selfRenders++;
      return origRender.apply(this, args);
    };
    Markdown.prototype.render = patchedRender;
  }

  installed = {
    screen,
    origFrame,
    patchedFrame,
    scans,
    Markdown,
    origRender,
    patchedRender,
  };
  return { state: "active", reason: null };
}

/** Restore everything, unless something else wrapped it after us. */
export function uninstall() {
  if (!installed) return true;
  const {
    screen,
    origFrame,
    patchedFrame,
    scans,
    Markdown,
    origRender,
    patchedRender,
  } = installed;
  if (screen.doRender !== patchedFrame) return false;
  screen.doRender = origFrame;
  for (const { name, orig, patched } of scans) {
    if (screen[name] === patched) screen[name] = orig;
  }
  if (patchedRender && Markdown.prototype.render === patchedRender)
    Markdown.prototype.render = origRender;
  installed = null;
  return true;
}

export function getStats() {
  const frameMs = Number(counters.frameNs) / 1e6;
  const scanMs = Number(counters.imageScanNs) / 1e6;
  return {
    frames: counters.frames,
    frameMs: +frameMs.toFixed(1),
    msPerFrame: +(counters.frames ? frameMs / counters.frames : 0).toFixed(3),
    imageScanMs: +scanMs.toFixed(1),
    imageScanShare: +(frameMs ? (100 * scanMs) / frameMs : 0).toFixed(1),
    hostRenders: counters.hostRenders,
    selfRenders: counters.selfRenders,
  };
}

/** One line for /rcstats: frames, cost, and who asked for the renders. */
export function metricsLine(stats) {
  const origin =
    stats.hostRenders === 0 && stats.selfRenders > 0
      ? `markdown renders: ${stats.selfRenders} all self-checks, NONE from pi`
      : `markdown renders: ${stats.hostRenders} from pi, ${stats.selfRenders} self-checks`;
  return (
    `frames ${stats.frames} | ${stats.msPerFrame} ms/frame | ` +
    `image scan ${stats.imageScanMs} ms (${stats.imageScanShare}% of frame time)\n${origin}`
  );
}
