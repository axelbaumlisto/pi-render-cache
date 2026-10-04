/**
 * render-cache — pi extension (thin wiring layer).
 *
 * Patches Markdown.prototype.render (incremental streaming render, src/md-cache.js)
 * and Intl.Segmenter.prototype.segment (ICU memoization, src/seg-cache.js).
 *
 * All decision/transition logic lives in src/patch-state.js so tests can drive
 * the real code without a pi host. Per-patch lifecycle:
 *   - md-cache (v1.2.0) has NO implementation-hash or pi-version allowlist:
 *     a fresh install runs a behavioral differential canary on the REAL host
 *     prototypes (patched vs pristine byte equality on a representative corpus
 *     with the host's markdown theme) and stays "unsupported" on any mismatch
 *     or when the canary produces no cache activity. At runtime, sampled
 *     miss-time self-verification re-checks stitched output against the
 *     original renderer and permanently falls back on divergence.
 *   - seg-cache is evaluated INDEPENDENTLY (descriptor writable+configurable
 *     plus a native-behavior canary); one patch's failure never affects the other.
 *   - Shared state on globalThis symbols lets /reload adopt; a foreign function
 *     where ours/original should be → "ownership-lost", never layer, never
 *     restore, restart required.
 * Counters are observability only — there is NO zero-activity self-disable
 * after activation.
 *
 * pi-tui via BARE specifier only: jiti aliases it to pi's own copy → same
 * prototype pi renders with. NEVER a plugin dep. The markdown theme module is
 * resolved FROM the selected pi root (scripts/resolve-pi.mjs) and shares live
 * theme state with the host through the global theme symbol.
 */
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getCapabilities as packageGetCapabilities,
  Markdown as PackageMarkdown,
} from "@earendil-works/pi-tui";
import { getStats as mdStats } from "../src/md-cache.js";
import {
  mdOwnership,
  segOwnership,
  setupMd,
  setupSeg,
  summary,
} from "../src/patch-state.js";
import { getStats as segStats } from "../src/seg-cache.js";
import {
  getStats as metricsStats,
  install as installMetrics,
  metricsLine,
} from "../src/metrics.js";
import { markdownCachePolicy } from "../src/md-policy.js";
import { reachLine } from "../src/stats.js";
import {
  resolveLiveTuiModule,
  resolvePiRoot,
  resolveThemeModule,
} from "../scripts/resolve-pi.mjs";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

/**
 * Load the host's markdown theme for the differential canary. The theme module
 * file shares live theme state with the bundled host through the global theme
 * symbol, so getMarkdownTheme() reflects the active theme. Returns null when
 * unavailable (md-cache then stays "unsupported" — fail closed).
 */
/** Turn a theme module (host package or file path) into the markdown theme object. */
function themeFrom(mod: Record<string, unknown>): object | null {
  if (
    !(globalThis as Record<symbol, unknown>)[THEME_KEY] &&
    typeof mod.initTheme === "function"
  ) {
    (mod.initTheme as (name: string) => void)("dark"); // no watcher; host re-initializes with the user's theme
  }
  const theme =
    typeof mod.getMarkdownTheme === "function"
      ? (mod.getMarkdownTheme as () => unknown)()
      : null;
  return theme !== null && typeof theme === "object" ? (theme as object) : null;
}

async function loadMarkdownTheme(): Promise<object | null> {
  // 1. The host package itself. pi re-exports getMarkdownTheme from its main
  //    entry and provides the package to extensions, so this works whatever the
  //    install layout is — including pi's managed install (>=1.0.1), where the
  //    `pi` on PATH is a shell launcher and the package lives under
  //    ~/.pi/agent/install/releases/<version>/node_modules/. Walking the
  //    filesystem from the launcher finds nothing there, which is what turned
  //    md-cache "unsupported: markdown theme unavailable" after `pi update`.
  try {
    const host =
      (await import("@earendil-works/pi-coding-agent")) as unknown as Record<
        string,
        unknown
      >;
    const theme = themeFrom(host);
    if (theme) return theme;
  } catch {
    /* host import unavailable (tests, odd hosts) → fall through to the path */
  }

  // 2. Filesystem resolution: PI_PACKAGE_ROOT fixtures and any host that does
  //    not re-export the theme from its entry point.
  try {
    const root = resolvePiRoot().root;
    const themePath = resolveThemeModule(root).path;
    return themeFrom(
      (await import(pathToFileURL(themePath).href)) as unknown as Record<
        string,
        unknown
      >,
    );
  } catch {
    return null;
  }
}

export default async function (pi: ExtensionAPI) {
  // Evaluate each patch INDEPENDENTLY; failures never cross over.
  const theme = await loadMarkdownTheme();
  // Patch what pi runs, not what npm installed beside it: since 0.84.3 the
  // renderer lives in pi's own bundle and the package copy is never loaded.
  // Measured on a live session — 0 calls through the package, 50 through the
  // bundle. Older layouts have no bundle; there the package IS the renderer.
  let Markdown = PackageMarkdown;
  let getCapabilities = packageGetCapabilities;
  let rendererSource = "package";
  let piVersion: string | null = null;
  try {
    const info = resolvePiRoot();
    piVersion = info.version ?? null;
    const live = await resolveLiveTuiModule(info.root);
    if (live) {
      Markdown = live.module.Markdown;
      getCapabilities = live.module.getCapabilities;
      rendererSource = `bundle:${live.path.split("/").pop()}`;
    }
  } catch {
    // fall back to the package; /rcstats reports which one was patched
  }

  // Caching markdown stopped paying when pi started caching renders itself —
  // see src/md-policy.js for the measurement that decides this.
  const policy = markdownCachePolicy({ piVersion });
  const md = policy.install
    ? setupMd({ Markdown, getCapabilities, theme, budgetChars: 2_000_000 })
    : { state: "off" as const, reason: policy.reason };
  // Counters for the session you are actually in — see src/metrics.js for why
  // no scripted run can stand in for one.
  try {
    const live = await resolveLiveTuiModule(resolvePiRoot().root);
    if (live?.module?.TuiMainScreen)
      installMetrics({ TuiMainScreen: live.module.TuiMainScreen, Markdown });
  } catch {
    // counters are a diagnostic, never a reason to fail startup
  }
  const seg = setupSeg({ budgetChars: 2_000_000 });

  // Notify only when something is NOT active, with per-patch reason.
  if ((md.state !== "active" && md.state !== "off") || seg.state !== "active") {
    pi.on("session_start", (_event, ctx) => {
      const parts: string[] = [];
      if (md.state !== "active")
        parts.push(`md-cache ${md.state}: ${md.reason ?? "n/a"}`);
      if (seg.state !== "active")
        parts.push(`seg-cache ${seg.state}: ${seg.reason ?? "n/a"}`);
      ctx.ui.notify(`render-cache: ${parts.join(" | ")}`, "warning");
    });
  }

  pi.registerCommand("rcstats", {
    description:
      "render-cache per-patch state, ownership, versions, counters, memory",
    handler: async (_args, ctx) => {
      const s = summary();
      const m = mdStats();
      const g = segStats();
      const fmt = (p: { state: string; reason: string | null }) =>
        p.state + (p.reason ? ` (${p.reason})` : "");
      let versions = "pi ?/pi-tui ?";
      try {
        // Light ESM import of the shared resolver (shipped in scripts/).
        const rp = await import("../scripts/resolve-pi.mjs");
        const piInfo = rp.resolvePiRoot();
        const tuiInfo = rp.resolvePiTui(piInfo.root);
        versions = `pi ${piInfo.version}/pi-tui ${tuiInfo.version}`;
      } catch {
        // resolver unavailable (unusual install layout) → versions stay unknown
      }
      // "active" only says the patch is installed. Reporting that alone is how
      // this extension stayed a no-op for six weeks after pi bundled its TUI, so
      // say out loud whether the renderer has actually called it.
      ctx.ui.notify(
        `${reachLine(rendererSource, m)}\n${metricsLine(metricsStats())}\n` +
          `md ${fmt(s.md)} own=${mdOwnership(Markdown)} h${m.hits}/m${m.misses}/f${m.fallbacks} size ${m.size} chars ${m.chars} | ` +
          `seg ${fmt(s.seg)} own=${segOwnership()} h${g.hits}/m${g.misses}/f${g.fallbacks} size ${g.size} chars ${g.chars} | ` +
          versions,
        "info",
      );
    },
  });
}
