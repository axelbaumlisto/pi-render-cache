# Where the core goes on pi 1.0.2

Measured with the probes in this directory: a real `pi` in a pty at 50x160,
Apple M3, Node 22.23, no other extensions loaded.

## The frame is redrawn whole, and the cache that would stop it lives one frame

`renderLayoutFrame` builds its context fresh on every frame:

```js
function renderLayoutFrame(root, width, height, requestRender) {
  let context = { viewport: {...}, renderCache: new Map, requestRender, ... }
```

`renderCached(context, component, width)` therefore only dedupes the repeated
measure/render passes *within* one frame. Between frames nothing is kept, so
every component in the retained tree renders again.

There is no invalidation signal to build on either: `invalidate()` only walks
down into children, and the TUI has no dirty flag, revision or version — those
words do not appear in the bundle.

## Cost scales with session size, not with what is visible

Same scenario each time: resume, scroll the history, ask for an answer, 40 s.

| Session | Frames | ms/frame | Renders per frame | Biggest contributors |
|---|---:|---:|---:|---|
| fresh | 19 | 0.66 | 24 | Container 209, Spacer 140, Text 86 |
| 224 MB | 20 | 9.88 | 411 | Container 2614, Spacer 1965, MouseRegion 1332 |
| 98 MB | 5 | 95.12 | 193 | Container 339, Spacer 217, MouseRegion 140 |
| 85 MB | 22 | 7.52 | 198 | Container 1344, Spacer 1144, MouseRegion 646 |
| 76 MB | 4 | 49.90 | 225 | Container 330, Spacer 212, Text 129 |

Rows with four or five frames are dominated by the first paint of the whole
transcript; the rows with twenty-odd frames show the steady state. A viewport
holds some 50 rows, yet 200-400 components render per frame.

At 8-10 ms a frame, a redraw every 80 ms is already a tenth of a core, and
anything that redraws per keystroke or per streamed chunk takes the rest.

## An external cross-frame cache is fast and wrong

`probes/xframe.ts` keeps rendered lines across frames, keyed by component,
width and a content signature — a leaf's text, a container's children hashed
recursively. On the 224 MB session:

| Mode | ms/frame | Hit rate | Sampled hits verified | Stale |
|---|---:|---:|---:|---:|
| off | 10.53 | — | — | — |
| leaves only | 10.75 | 18.8% | 233 | 0 |
| everything | 6.21 | 35.6% | 49 | **6** |

Two things follow. Caching leaves is sound and buys nothing — a `Markdown`
already keeps its own last lines, and the rest are cheap. Caching containers is
where the 1.8x lives, and it is where the signature breaks: six of 49 verified
hits returned lines that differed from a fresh render, every one of them a
container. Container output depends on state a content signature cannot see.

So this cannot be fixed correctly from outside. It needs to happen where the
layout owns that state: keep `renderCache` across frames and invalidate it when
a component actually changes.

## What this says about the markdown half of #6665

On 1.0.2 a streamed answer never touches `Markdown`: patching `addChild` on
every container class shows `ExpandableText`, `Container` and `Spacer`, with
zero `Markdown` instances built and zero calls to `Markdown.prototype.render`.
History rendering still uses it. Measured against the classes a real pi loads,
an external markdown cache now runs at 0.83x — slower than not caching — while
the grapheme segmentation cache still returns 1.07x.

The per-chunk markdown rebuild this issue opened with is no longer the cost.
The whole-tree redraw is.
