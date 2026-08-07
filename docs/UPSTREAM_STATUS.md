# Upstream status and release evidence

Checked **2026-08-07** against released pi **0.84.1**, commit [`53fa77ccd8a279eb87e92294ef3687b03ff80112`](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112), and newer upstream `main` commit [`958c13f25080b59d4b736193f972a8502a7a2f8b`](https://github.com/earendil-works/pi/tree/958c13f25080b59d4b736193f972a8502a7a2f8b). No intervening commit touches the four hot-path files, and both targets from #6665 remain present:

- [`AssistantMessageComponent.updateContent()` still clears its container](https://github.com/earendil-works/pi/blob/958c13f25080b59d4b736193f972a8502a7a2f8b/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L89-L95) and [constructs a fresh `Markdown`](https://github.com/earendil-works/pi/blob/958c13f25080b59d4b736193f972a8502a7a2f8b/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L104-L116) for streamed assistant text.
- [`Markdown.render()` still lexes the complete transformed text](https://github.com/earendil-works/pi/blob/958c13f25080b59d4b736193f972a8502a7a2f8b/packages/tui/src/components/markdown.ts#L285-L303) on a cold component.
- pi-tui still creates shared [`Intl.Segmenter` instances](https://github.com/earendil-works/pi/blob/958c13f25080b59d4b736193f972a8502a7a2f8b/packages/tui/src/utils.ts#L4-L18) and repeatedly calls `segment()`, including the [visible-width path](https://github.com/earendil-works/pi/blob/958c13f25080b59d4b736193f972a8502a7a2f8b/packages/tui/src/utils.ts#L270-L286).

## Related upstream work

- [#6665](https://github.com/earendil-works/pi/issues/6665) is open, assigned, and marked in progress.
- [#7017](https://github.com/earendil-works/pi/pull/7017) was closed without merge. It limits terminal output after component rendering, so it complements rather than replaces the inner Markdown-render cache.
- [#7082](https://github.com/earendil-works/pi/pull/7082) was closed without merge. It targets outer transcript/per-keystroke work, so it complements rather than removes Markdown rebuilds or segmentation calls.
- [#6792](https://github.com/earendil-works/pi/issues/6792) is excluded from core-performance evidence: its reporter retracted the report after identifying an extension fault.

## Controlled v1.1.0 evidence

Apple M3, Node 22.23.0, ICU 78.2, pi/pi-tui 0.82.1; 20 randomized complete blocks per workload and three repetitions per isolated mode run. Speedup is baseline divided by mode time; brackets are 95% paired whole-block bootstrap CIs. RSS values are median paired mode-minus-baseline replay-peak/retained-end deltas; negative is lower.

| Workload | Mode | Median speedup [95% CI] | Paired RSS Δ peak / retained end (MiB) |
|---|---|---:|---:|
| ordinary Markdown | seg-cache | 1.38× [1.30, 1.60] | +0.31 / +0.25 |
| ordinary Markdown | md-cache | 16.70× [14.97, 18.25] | -9.83 / -10.95 |
| ordinary Markdown | both | 21.22× [20.03, 23.68] | -8.36 / -8.77 |
| styled thinking | seg-cache | 1.61× [1.52, 1.69] | -0.46 / -0.46 |
| styled thinking | md-cache fallback | 1.01× [0.87, 1.08] | +0.31 / +0.31 |
| styled thinking | both | 1.64× [1.57, 1.70] | -0.35 / -0.35 |
| Unicode width | seg-cache | 2.79× [2.50, 3.13] | +2.62 / +2.67 |
| Unicode width | md-cache | n/a (no Markdown work) | -0.10 / -0.10 |
| Unicode width | both | 2.97× [2.84, 3.11] | +3.45 / +3.75 |

All Checkpoint B paired replay-peak RSS gates passed the +20 MiB limit; the worst median increase was +3.45 MiB.

The durable sanitized result, environment, hashes, and exact unrounded values are in [`evidence/v1.1.0/summary.json`](https://github.com/axelbaumlisto/pi-render-cache/blob/v1.1.0/evidence/v1.1.0/summary.json). From a source checkout, reproduce the full run with `npm run premise`; use `npm run test:perf` for a short non-release performance check and `npm run compat` for the selected compatibility unit.

On pi 0.82.1 both patches are **active** after their independent canaries. `md-cache` deliberately falls back for styled thinking because it has a non-null text style; that path is enforced by tests and is not claimed as cacheable. `seg-cache` remains active there and produced about 1.6× in the controlled replay.

## Live pi 0.82.1 smoke check

After the automated gates, the packaged extension was loaded by the real pi host with `pi -e ./extensions/index.ts --no-session -p ...`. An in-process probe verified the actual host prototypes and lifecycle state:

```text
LIVE_CHECK {"mdState":"active","segState":"active","mdPatched":true,"segPatched":true}
```

The request completed and rendered normally. This is an ecological load/wiring check; controlled performance claims still come only from the blocked replay above.

## Independent retirement protocol

Each patch is retired independently and only after correctness parity; see the [full plan](https://github.com/axelbaumlisto/pi-render-cache/blob/v1.1.0/.pi/plans/validate-and-extend-render-cache.md#retirement-protocol-future-released-upstream).

- **Structural no-work route:** released upstream removes the hot path; reachability, canaries, and deterministic replay show no reachable work or hits; then soak/live-check removal.
- **Statistical equivalence route:** the patch remains active with nonzero work; run at least 20 randomized complete blocks per workload and representative supported environment.
- Do not pool environments; a one-platform result retires the patch only on that platform.
- Use the two predeclared marginal contrasts per patch with the no-patch mode as denominator.
- CPU and latency use within-block log ratios and paired 95% whole-block bootstrap CIs.
- Equivalence requires every interval inside ratio margin `[0.95, 1.05]`; memory uses paired replay-peak and retained-end RSS with a justified margin.
- Fix sample count before the final run; no optional stopping.
- Report exactly one outcome: **equivalent**, **not equivalent**, or **inconclusive**; failure to prove equivalence is not automatically a meaningful difference.
- All workload, metric, and environment intervals must pass, followed by a soak/live ecological check before removal.
