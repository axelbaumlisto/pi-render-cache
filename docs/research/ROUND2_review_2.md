# ROUND 2 — Integration critic review: render-cache plan vs. real pi runtime

Reviewer role: senior integration critic (first reading). Plan: `/tmp/render-cache-plan-clean.md`.
Sources verified on this machine: pi-coding-agent (Node install, `/Users/shamash/local/bin/pi` → `dist/cli.js`), pi-tui 0.80.7, jiti 2.7.0, Node v22.23.0.

---

## 1. Dual-instance verdict: **NOT a risk — extension gets THE SAME `Markdown` class/prototype** (verified empirically)

### Evidence

**a) Alias config (Node/dev mode).** `dist/core/extensions/loader.js:59-107` (`getAliases()`): `"@earendil-works/pi-tui"` is aliased to the **absolute path** of pi's own copy, resolved via `resolveWorkspaceOrImport("tui/dist/index.js", "@earendil-works/pi-tui")` (loader.js:77) → `/Users/shamash/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js` — the exact file pi's dist code imports. Only one pi-tui copy exists in this install (verified: `node_modules/@earendil-works/` contains pi-agent-core, pi-ai, pi-tui only).

**b) jiti evaluation semantics for the resolved dep.** `loader.js:308-313`: `createJiti(import.meta.url, { moduleCache: false, alias: getAliases() })` (Node mode; Bun-binary mode uses `virtualModules` + `tryNative:false`). In jiti 2.7.0's `jitiRequire`/`eval_evalModule` (dist/jiti.cjs), an aliased import that resolves to a **`.js` file inside a `"type":"module"` package** is NOT transpiled/re-evaluated by jiti: the transpile condition `S = !cjs && !(esm && async) && (...)` is false for an async ESM import of an `.mjs`-typed `.js` file, so jiti delegates to `nativeImportOrRequire` → **Node's native `import(fileURL)`** → Node's process-wide ESM module registry. pi-tui's package.json is `"type": "module"` (verified), so the extension's import lands on the **same registry entry** pi's own dist code loaded. `moduleCache:false` only deletes entries from `nativeRequire.cache` (the **CJS** cache — see the `delete e.nativeRequire.cache[t]` sites in jitiRequire); the ESM registry cannot be cleared and is untouched. So `moduleCache:false` affects re-evaluation of the **extension file itself** (transpiled TS evaluated via `vm.runInThisContext`), not its native-ESM deps.

**c) Bun binary mode.** `loader.js:30-52` `VIRTUAL_MODULES` maps `"@earendil-works/pi-tui"` to the statically imported `_bundledPiTui` namespace — literally the same module object the binary itself uses. jitiRequire short-circuits on `virtualModules` before any resolution (verified in dist/jiti.cjs: `if(e.opts.virtualModules && t in e.opts.virtualModules) ... return jitiInteropDefault(...)`). Same instance by construction. `isBunBinary` (dist/config.js:16) keys off `$bunfs`/`~BUN` in `import.meta.url`; this install is plain Node, so alias mode applies here.

**d) Empirical probe** (run during this review, `/tmp/segcache-review/probe/probe.mjs`): loaded a `.ts` extension importing `{ Markdown } from "@earendil-works/pi-tui"` through `createJiti(..., { moduleCache:false, alias })` exactly as loader.js does, and compared against a direct native import of pi-tui:

```
same class object: true
same prototype:    true
patch visible on native side: true   (Markdown.prototype patched via extension side, seen natively)
reload same class: true              (second createJiti + re-import → same class)
```

**Verdict: single-instance confirmed in both loader modes. A `Markdown.prototype.render` patch installed from an extension lands on the prototype pi's UI actually calls.** Residual caveat: this holds only for the bare specifier `@earendil-works/pi-tui` (or the `@mariozechner/*` legacy alias). If the extension ever imports pi-tui via a relative path or ships its own pi-tui dependency, it duplicates. The plan already uses the aliased specifier — keep it that way and never add pi-tui to the plugin's own package.json deps.

---

## 2. Cache-key correctness — **theme identity alone is UNSOUND; two concrete gaps**

Constructor: `markdown.js:58` — `(text, paddingX, paddingY, theme, defaultTextStyle, options)`. Everything except `text` participates in output:

- `theme.*` functions colorize every token (headings/code/links/quotes/bullets/tables — markdown.js renderToken throughout).
- `defaultTextStyle` changes inline text styling AND the background/padding stage (`bgFn` at the wrap stage).
- `options.preserveBackslashEscapes` (escape tokens) and `options.preserveOrderedListMarkers` (list bullets) change bytes. Used in the real runtime: `dist/modes/interactive/components/user-message.js:29`.
- `paddingX` changes every line (left/right margins + width padding).

So yes: **two Markdown instances with different theme/defaultTextStyle/options/paddingX produce different lines for identical (text,width)** — all of these must be in the key or force fallback. The plan handles `defaultTextStyle` and `paddingY>0` via fallback (I6) but is silent on `options` and `paddingX`. Both must be addressed:
- `paddingX` **must be a key component, not a fallback** — the hot path (`assistant-message.js:77`) always uses `paddingX = outputPad = 1`; falling back on paddingX≠0 would nullify the whole optimization.
- `options`: either fallback when non-empty, or serialize the two booleans into the key (they're the whole options surface today, but a serialized allowlist is fragile against pi-tui upgrades → prefer fallback-when-any-option-set, which is fine because the streaming hot path passes no options).

### Gap 1 (correctness, real): WeakMap theme→id identity keying is broken by live theme switching

pi's markdown theme functions are **thin closures over a globalThis proxy**, not value carriers:
- `dist/modes/interactive/theme/theme.js:612-618`: `export const theme = new Proxy({}, { get: … globalThis[THEME_KEY] … })`, `THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme")` (theme.js:608).
- `getMarkdownTheme()` (theme.js:1000) returns `{ heading: (t) => theme.fg("mdHeading", t), … }` — every function reads the **current** global theme at call time.
- Theme switching / hot-reload calls `setGlobalTheme(...)` (theme.js:620-623, watcher at 680-750), then `onThemeChange → ui.invalidate() → requestRender()` (interactive-mode.js:563-566).

Consequence: after a `/theme` switch or a custom-theme file hot-reload, existing components re-render (`AssistantMessageComponent.invalidate → updateContent`, assistant-message.js:31-34) passing the **same theme wrapper object** (`this.markdownTheme`, captured at construction) — same WeakMap identity — but the correct output now has **different ANSI codes**. An identity-keyed global cache returns **stale-colored lines** until eviction. The original per-instance path is immune because `updateContent` builds fresh `Markdown` instances with empty caches.

Fixes (pick one):
1. **Theme epoch in the key**: define a getter/setter on `globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")]` from the extension to bump an epoch counter whenever `setGlobalTheme` assigns (and mirror the `…:theme` old key). Works but touches pi internals; must be reversible for uninstall. Do NOT use `onThemeChange()` — it is a single-slot callback (theme.js:685-687) already owned by interactive-mode.js:563; registering would clobber the UI's handler.
2. **Cheap theme fingerprint in the key**: on each patched render, compute e.g. `theme.heading("x") + theme.code("x") + theme.listBullet("x") + theme.quote("x")` and hash it into the key. O(µs), no pi-internal coupling, also automatically covers `codeBlockIndent` (which is merged per-call in `getMarkdownThemeWithSettings()`, interactive-mode.js:758-763) if you also fingerprint `theme.codeBlockIndent`. **Recommended.**
3. Fallback whenever theme !== last-seen theme fingerprint → flush cache. Equivalent to 2 with a global flush.

Note identity keying is *directionally* fine for the hot loop itself: the streaming component is constructed once per assistant message with one theme object (`interactive-mode.js:2324`), and every `message_update` rebuild passes the same `this.markdownTheme` — so hits occur within a stream. The bug is exclusively cross-theme-switch staleness, which is exactly the kind of rare wrongness that survives the I1/I5 corpus unless a test deliberately mutates the global theme between renders. **Add such a test.**

### Gap 2 (perf coverage, not correctness): thinking blocks never hit the cache

`assistant-message.js:94-97` constructs thinking Markdown with a **fresh `defaultTextStyle` object literal and fresh closure on every `updateContent`** (i.e., every stream delta). Plan I6 says defaultTextStyle → fallback. That is safe, but it means **thinking-token streaming — often the majority of streamed tokens — remains O(full text) per frame**. The Ф3 CPU gate (105% → 20-40%) may fail on thinking-heavy models purely because of this. Options: (a) accept and document; (b) treat the specific `{color:fn, italic:true}` shape as cacheable by fingerprinting the style prefix via the same sentinel trick the component itself uses (`getDefaultStylePrefix()`, markdown.js sentinel `\u0000`) — the style prefix string is a sound key component since fg color goes through the theme proxy (so combine with the theme fingerprint). (b) is worth doing; without it the headline perf claim is at risk.

Also include in the key or verify-stable: `getCapabilities().hyperlinks` (terminal-image.js:81-86, module-level cached) changes link rendering (OSC 8 vs `text (url)`); it's process-stable in practice, but `setCapabilities()/resetCapabilitiesCache()` exist — one bit in the key costs nothing.

---

## 3. Scratch-instance pitfalls

Per-instance state affecting output is fully enumerated by the constructor params plus one memo: `defaultStylePrefix` (lazily computed, derived — harmless). The class holds no other hidden state; `markdownParser` (Marked instance) is **module-level shared** (markdown.js top) — the scratch instance uses the same lexer as pi's, good.

Real pitfalls to handle:

1. **Inter-block spacing at the seam (the big one).** `renderToken` appends a spacing `""` after headings/paragraphs/code/blockquotes **only when `nextTokenType` exists and ≠ "space"**. When the settled prefix is rendered standalone, its last block sees `nextTokenType === undefined` → **no trailing blank emitted**; in the full-document render, that block would be followed by a `space` token (which itself renders `""`). Equivalence therefore holds **only if the splitter leaves the separating blank line(s) at the head of the tail**, so the tail's leading `space` token re-emits the `""`. If the split consumes the blank into settled, output diverges (missing/extra blank line). Byte-diff tests (I1/I5) will catch this, but the split contract must state it explicitly: *settled ends at the last block's final newline; all blank separator lines belong to the tail*.
2. **The `[""]` guarantee.** `render()` returns `[]` for empty/whitespace text but guarantees `result.length > 0 ? result : [""]` for non-empty text (markdown.js:152). The stitched patched result must reproduce this exactly, including the empty-text early-return path (which also populates the per-instance cache — see below).
3. **Per-instance cache fields must stay coherent.** The parent render path can call `render(width)` more than once per frame (Container.render at tui.js:96-104 iterates children; overlay compositing at tui.js:808 calls `component.render(width)` again; `AssistantMessageComponent.render` wraps `super.render` and mutates only its own copy — Container builds a fresh array, so mutation of `lines[0]` (OSC133 zone markers, assistant-message.js:54-60) never corrupts a shared cached array; strings are immutable). The patched render must **still write `cachedText/cachedWidth/cachedLines`** (markdown.js:55-57, checked at :77) so the second same-frame call takes the O(1) instance path, and must respect `invalidate()`/`setText()` clearing them. Return a stable array per (instance,text,width) like the original does; do NOT return the globally cached array object itself for the settled part — concat into a fresh array per instance to keep ownership semantics identical (Container copying protects you today, but the global array must never be handed out as a mutable return value).
4. **Images/OSC.** The Markdown renderer never *generates* kitty/iTerm image sequences itself (no `image` token case in renderToken — images degrade to plain text via the default case); `isImageLine` checks are defensive pass-throughs for lines that could contain them (e.g., via raw HTML/injected content). OSC 8 hyperlinks are deterministic per (text, capabilities). OSC 133 zone markers are added *above* Markdown in AssistantMessageComponent. So no per-render nondeterminism inside the class — scratch-instance tail render is sound. The only nondeterministic ID allocator (`allocateImageId`, terminal-image.js) is not on the Markdown path.
5. **`trimPartialClosingFences` (markdown.js:21-40)** mutates the last token during streaming (partial ``` fences). It only affects the **document tail** — which is exactly the part the plan re-renders originally. Fine, but it's another reason the splitter must never settle a block whose fence state is open (plan already says this).
6. **Width guard**: `contentWidth = max(1, width - paddingX*2)`; cache key must be the outer `width` (it is, per plan) — fine since paddingX is also keyed (see §2).

---

## 4. Self-check + /reload robustness

### Self-check (count patched-render invocations, 5s, 0 → self-disable)

- **Yes, there is a legitimate-zero race.** A fresh idle `pi` session can plausibly render **no Markdown at all for >5s**: the footer/editor/prompt are not Markdown components; changelog Markdown only renders on version updates (interactive-mode.js:464/4745); user/assistant message Markdown only appears after input. Result: false self-disable on quiet startups, and the plugin then stays off for the whole session. Since §1 proves dual-instance is effectively impossible in both loader modes, the check as designed has a **worse false-positive profile than the risk it guards against**.
- **Fix**: make the check event-gated, not wall-clock-gated. The extension can register `pi.on("message_update", …)` (agent-loop drives these per delta); after the **first** message_update, a Markdown render is guaranteed within one frame (≤16ms, `TUI.MIN_RENDER_INTERVAL_MS`), so: arm a 1-2s timer on first message_update; if the patched-render counter is still 0 *then*, self-disable + notify. Zero renders before any message activity is never treated as failure. Also exclude the extension's own smoke-test render (if any) from the counter, or the check is vacuous.

### /reload + idempotency

- Reload path confirmed: `DefaultResourceLoader.reload()` calls `clearExtensionCache()` (dist/core/resource-loader.js:219) → factory cache cleared (loader.js:113-118, generation counter). With `moduleCache:false` the extension **file** is re-transpiled and re-evaluated into a **fresh module scope** (fresh closures, fresh module-level state) — while `Markdown.prototype` persists (§1 probe: "reload same class: true").
- Therefore the **`Symbol.for` marker pattern works and is necessary**: put the guard + shared state (original render ref, cache, stats) on `globalThis[Symbol.for("render-cache:v1")]` (or as a symbol-keyed property on `Markdown.prototype`), never in module scope. On re-install: if the marker exists, **adopt** the existing shared state (so `/rcstats` from the fresh module instance sees real counters) rather than no-op'ing — a bare "already installed, return" guard would leave the reloaded module blind to its own cache.
- **Uninstall/restore is feasible**: keep `originalRender` in the shared symbol slot; `uninstall()` = `Markdown.prototype.render = originalRender; delete globalThis[sym]`. One hazard: if **another** extension also wraps `render` after you, restoring your saved original silently drops their wrapper. Mitigation: on uninstall, check `Markdown.prototype.render` is still your function before restoring; if not, mark self-disabled instead of restoring (standard monkey-patch etiquette). Same applies to the `Intl.Segmenter.prototype.segment` patch.
- Factory re-run on new/resume/fork (per docs/extensions.md lifecycle, `session_shutdown` reasons `"quit"|"reload"|"new"|"resume"|"fork"`, types.d.ts:454-455) without cache-clear: same idempotency guard covers it. Register a `session_shutdown` handler only if you hold session-scoped resources — the caches are process-scoped and should survive session switches (that's the point).
- Version-drift guard: stamp the shared state with pi-tui's version (importable from its package.json is awkward; a hash of `Markdown.prototype.render.toString()` at install time works) so a pi self-update mid-process (rare, but /reload after `pi update` in dev layouts) triggers fallback rather than stitching against a changed renderer.

---

## 5. VERDICT: **CONDITIONAL GO** — maturity **7/10**

The plan's central feasibility bet — patching `Markdown.prototype.render` from an extension and having pi's own render path hit the patch — is **confirmed against the real runtime in both loader modes** (alias→native-ESM-registry in Node; virtualModules→same namespace object in Bun binary; empirically probed). The TDD/byte-diff/fallback-by-default architecture is the right shape, and the per-instance-cache interaction is tractable.

Conditions (must-fix before Ф3):
1. **Theme staleness**: identity-only WeakMap theme keying returns wrong colors after `/theme` switch or theme hot-reload (globalThis-proxy theme, theme.js:608-623). Add a theme fingerprint/epoch to the key + a dedicated test that mutates the global theme between renders. *(Correctness — blocking.)*
2. **Key completeness**: `paddingX` in the key (not fallback — hot path uses paddingX=1); `options` non-empty → fallback; consider `getCapabilities().hyperlinks` bit. *(Correctness — blocking.)*
3. **Self-check redesign**: gate on first `message_update` + short timer instead of a flat 5s window; a quiet startup legitimately renders zero Markdown and must not self-disable. *(Robustness — blocking, cheap.)*
4. **Split contract**: blank separator lines must belong to the tail, or the settled prefix loses inter-block spacing (`renderToken`'s `nextTokenType`-conditional `""`). Encode as an explicit split.js invariant + test. *(Correctness — will be caught by I1/I5 anyway, but should be a stated contract, not a debugging discovery.)*
5. **Reload semantics**: symbol-slot shared state with *adopt-on-reinstall*; safe uninstall that checks it still owns `render`. *(Robustness.)*

Strongly recommended (not blocking): cacheable handling of the thinking-block `defaultTextStyle` (assistant-message.js:94 creates a fresh style object per delta — with plain fallback, thinking-heavy streams get no speedup and the Ф3 CPU gate is at risk).

Scoring rationale: −1 theme staleness (real wrongness, undetected by planned corpus), −1 self-check false-positive design, −1 key/coverage gaps (options/paddingX/thinking). Everything else is well-conceived and grounded in verified facts about this codebase.

---
*Review artifacts: probe at `/tmp/segcache-review/probe/{ext.ts,probe.mjs}` (temp files only; no project/source files modified).*
