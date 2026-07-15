# pi-render-cache

**Stops a [pi](https://github.com/earendil-works/pi-coding-agent) coding-agent session from pinning a full CPU core while the model streams.**

A long-running interactive `pi` session burns **~100% of one core per streaming
turn** — several open sessions saturate the machine and push it into swap. This
extension brings a heavy streaming session down to **~10–16% of a core** with
**zero visible change** to the rendered output.

Pure monkey-patch, loaded into pi's own process. No pi-tui fork, no config.

---

## The problem (measured, not guessed)

A `spindump` of a session stuck at 100% CPU shows the hot path is **not** the LLM
or the network — it is the terminal **re-render**:

```
uv__run_timers → Environment::RunTimers            (pi-tui render timer, ≤60 fps)
  → Markdown.render → line wrap/truncate
    → Intl.Segmenter grapheme iteration → ICU BreakIterator   ← the fire
```

Two independent causes stack up:

1. **`Intl.Segmenter` has no cache.** pi-tui measures text width by iterating
   Unicode grapheme clusters through ICU on *every* wrap/truncate call. Any
   non-ASCII content (Cyrillic, Thai, emoji — and the box-drawing chars in pi's
   own UI) misses the ASCII fast-path and re-segments from scratch each frame.
2. **The streaming message is cold-rebuilt every chunk.**
   `AssistantMessageComponent.updateContent()` calls `clear()` + `new Markdown(...)`
   on *every* `message_update` (i.e. every token delta), throwing away pi-tui's own
   per-instance `cachedLines`. So the entire message-so-far is re-lexed, re-wrapped
   and re-segmented up to 60×/second — cost grows linearly with the answer length.

## What it does

Two surgical patches, each independently useful, each falling back to the
original renderer on any doubt:

| Patch | Target | Effect |
|-------|--------|--------|
| **seg-cache** | `Intl.Segmenter.prototype.segment` | Memoizes grapheme/word segmentation (LRU by `locale∙granularity∙string`, char-budgeted). Spread-of-native records → exact per-granularity shape; ASCII fast-path; `containing()` delegation. |
| **md-cache** | `Markdown.prototype.render` | Splits the streaming text into a **settled prefix** (stable across frames) + a **growing tail**; caches prefix lines globally by `(prefix, width, paddingX, themeFingerprint, hyperlinks)` and only re-renders the tail. Neutralizes the cold-rebuild. |

## Metrics

Measured on Apple M3, Node 22.23, real sessions with the extension loaded vs. an
identical un-patched session running side by side.

### CPU during streaming (per session)

| Scenario | Baseline | With extension |
|---|---|---|
| Heavy agent session (subagents streaming) | **~105%** of a core | **~37%** |
| 97 MB resumed session, long-markdown stream (opus, fast small chunks) | **~105%** | **~10–16%** |
| Same, large-chunk model (gpt-5.5) | **~105%** | **~8–10%** |

**~65–90 percentage-point drop.** Idle sessions were already ~0% and stay ~0%.

### Cache hit-rates (live `/rcstats`)

| Cache | Hit-rate | Notes |
|---|---|---|
| **seg-cache** | **94–99.6%** | e.g. `3,902,590 hits / 17,177 misses` in one session — the dominant win, exactly the `spindump` hotspot. |
| **md-cache** | **70%** on fast-streaming models (opus) | Dormant on models that stream in large infrequent chunks — seg-cache alone already covers those. |

### Correctness

- **64 automated tests**, byte-for-byte: patched `render()` output `===` the
  original on a markdown corpus × widths `[20, 24, 47, 80]`, plus an adversarial
  corpus (reference-link defs across the split, unclosed HTML blocks, `<a>`
  autolink-state leaks, list-continuation, fenced code, CRLF, RU/Thai/emoji).
- **Fuzz gate**: 6,500+ random-document byte-diffs, 0 failures.
- The split is *conservative by construction* — any construct that could make
  `render(prefix)+render(tail) ≠ render(full)` forces a full fallback to the
  original renderer. Worst case is lost speed-up, never wrong output.

## Install

```bash
# as a pi package (recommended)
pi install pi-render-cache
```

or via npm into your pi extensions:

```bash
npm install pi-render-cache
```

Then it auto-loads on the next `pi` start. Verify with `/rcstats`.

## Usage

Nothing to configure — it installs both patches on load and self-checks.

- `/rcstats` — one-line hit/miss/fallback counters for both caches.

## Safety

- **Same-process, same-prototype.** pi-tui is imported via its bare specifier, which
  pi's loader aliases to its own copy — the patch lands on the exact prototype pi
  renders with. pi-tui is a `peerDependency`, never bundled.
- **Idempotent** across `/reload` and session switch (shared state on a
  `Symbol.for` slot, adopt-on-reinstall). `uninstall()` restores the original only
  if it still owns the method — never clobbers another extension's wrapper.
- **Version-drift guard.** If pi's `Markdown.render` changed underneath (pi upgrade),
  the extension detects the hash mismatch and refuses to install rather than stitch
  against an unknown renderer.
- **Event-gated self-check.** If, after the first `message_update`, the patch shows
  zero activity (e.g. a future pi stopped using `Intl.Segmenter`), it self-disables
  and notifies — fail-safe, never silently wrong.

## Upstream context

Both root causes are already known upstream and remain unfixed in the core
(measured on pi 0.80.7):

- **[earendil-works/pi#4721](https://github.com/earendil-works/pi/issues/4721)** —
  *perf(tui): editor wrap/layout repeatedly re-segments lines and graphemes.*
  Same profile this extension targets (`JSSegmentIterator::Next` ~60%,
  `CreateSegmentDataObject` ~52%). Auto-closed. → **seg-cache** addresses it.
- **[earendil-works/pi#3758](https://github.com/earendil-works/pi/issues/3758)** —
  *Avoid rebuilding assistant message components during token streaming.*
  The cold-rebuild of the streaming `Markdown` component. Auto-closed. →
  **md-cache** addresses it.

pi's core is intentionally minimal and these live outside it, so this extension
is the pragmatic fix: no fork, no core change, drop-in.

## Limitations

- **Thinking blocks** stream through the fallback path (they carry a per-message
  text style), so thinking-heavy turns see a smaller md-cache win. seg-cache still
  applies.
- md-cache only helps models that stream in **many small chunks**; large-chunk
  models get their win almost entirely from seg-cache.
- The real long-term fix belongs upstream in pi-tui (don't cold-rebuild the
  streaming component; cache grapheme width). This extension is a zero-fork
  stop-gap that needs no changes to pi.

## License

MIT © 2026 Alexander Prilipko
