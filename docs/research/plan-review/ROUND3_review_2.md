## Review

- **Correct:** Independent lifecycle is now coherently planned. Task 2 requires per-patch `active`/`unsupported`/`ownership-lost` state, preserves bookkeeping after ownership loss, and explicitly tests asymmetric failures and reloads (`/tmp/pi-render-cache-plan-round3-clean.md:60-70`). This directly addresses the current coupled early return and coupled self-disable in `extensions/index.ts:43-65`. No remaining blocker found in this area.

- **Blocker — theme allowlisting has no feasible, attested runtime discriminator:** The safety contract promises that only the *exact* core theme implementation is invoked for fingerprinting and that unknown/custom themes receive zero analysis calls (`/tmp/pi-render-cache-plan-round3-clean.md:28-30,100-107`). The plan records implementation hashes, shapes, and canaries (`:54-57`), but never specifies how an arbitrary `this.theme` object is proven to originate from that implementation before its callbacks are invoked. A module/source hash authenticates the installed factory, not the provenance or closed-over state of an object passed to `Markdown`; shape and `Function.prototype.toString` hashes can be reproduced by custom closures and therefore are not “exact implementation” evidence. This matters because the current patch accepts any theme and immediately invokes callbacks (`src/md-cache.js:36-43,98`). Before implementation, the plan must name a non-invoking runtime discriminator that is available in both supported pi-tui units (for example stable core callback identities or a host-owned brand/token), and matrix canaries must prove that freshly created core themes pass while structurally/source-identical custom lookalikes fail without callback invocation. If neither fixture exposes such a discriminator, the claimed safe allowlist is infeasible and md-cache must be narrowed/disabled rather than relying on output/source probing.

- **Blocker — seg-cache remains materially unbounded while release and retirement memory claims assume the opposite:** Task 4 fixes retained key/value accounting only for md-cache (`/tmp/pi-render-cache-plan-round3-clean.md:97-109`). The shared cache currently trusts a caller-supplied character cost (`src/stats.js:19-50`), while seg-cache charges only `str.length` (`src/seg-cache.js:55-66`) despite retaining a locale/granularity key, the input, a result wrapper, an array, and up to one record object per segment (`src/seg-cache.js:12-32`). Thus a nominal 2M-character budget can retain orders of magnitude more heap than the stated budget and can exceed the +20 MiB gate depending on corpus. The retirement protocol then incorrectly justifies a ±10 MiB margin by that same “2M-char cache budget” (`/tmp/pi-render-cache-plan-round3-clean.md:162`). Add seg-cache retained-cost accounting, per-entry/total limits, and a worst-case high-segment-count memory validation before Checkpoint A; `/rcstats` must report this bounded measure. A workload-specific RSS pass alone does not establish a cache bound.

- **High — the compatibility unit is recorded exactly but not installed reproducibly:** The contract selects exact pi versions whose pi-tui dependency is a caret range (`/tmp/pi-render-cache-plan-round3-clean.md:37-43`). Task 1 installs exact pi fixtures and records the resulting transitive version (`:47-56`), but recording what npm happened to resolve does not make future clean runs resolve the same unit. Task 6 only pins matching pi-tui conditionally if direct type resolution is necessary (`:134-136`); dependency-layout convenience is unrelated to reproducibility. Each pi row must check in the exact pi-tui version/integrity and install it through an immutable fixture lock/override (then assert canonical resolution and hashes), regardless of whether a direct pi-tui dev/peer entry is needed. Otherwise the claimed tested compatibility unit and implementation allowlist can drift without a plan change.

- **Blocker — retirement rules make successful upstream removal potentially impossible to classify:** Retirement starts only after structural hot-path removal (`/tmp/pi-render-cache-plan-round3-clean.md:156-160`), but all marginal contrasts are declared interpretable only when the candidate patch is active and has nonzero hits (`:83-85`), and retirement requires that condition plus every interval passing (`:161-164`). A genuine upstream fix may eliminate all calls/work that produce hits; that result is classified “structurally inapplicable,” so it can never satisfy the mandated equivalence intersection. Define two explicit routes: (1) structural retirement when the hot path is absent and deterministic parity/canaries show the patch has no reachable work, with performance contrasts marked not applicable; and (2) statistical equivalence when the patch remains active with nonzero work, using the existing paired marginal contrasts. Retain independent per-patch and per-environment decisions in both routes.

## Verdict

**Not mature enough to execute as written.** The lifecycle direction and independent state model are sound, but three strategic contracts remain internally unrealizable or contradictory (theme provenance, honest seg-cache memory, and zero-work retirement), plus one mechanical reproducibility gap (exact pi-tui fixture locking).

**Strategic vs mechanical:** Strategic blockers require revising the safety/memory/retirement contracts before coding. Exact fixture locking is mechanical and can be folded into Task 1/6.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Four concrete blocker/high findings cite /tmp/pi-render-cache-plan-round3-clean.md, src/md-cache.js, src/seg-cache.js, src/stats.js, and extensions/index.ts with line numbers; residual risks are explicitly identified."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/ROUND3_review_2.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Read the permitted plan and source files; render numbered excerpts with nl/sed",
      "result": "passed",
      "summary": "Inspected only the requested plan, src/*.js, and extensions/index.ts inputs."
    }
  ],
  "validationOutput": [
    "Independent patch-state plan is coherent; no blocker found in that area.",
    "Theme provenance is not operationally discriminated before callback probing.",
    "seg-cache charges string length while retaining per-segment object graphs.",
    "Exact pi installs do not freeze caret-resolved pi-tui fixtures.",
    "Retirement requires nonzero patch work even when structural removal may eliminate that work."
  ],
  "residualRisks": [
    "No implementation or tests exist yet to demonstrate a non-invoking exact core-theme discriminator.",
    "Worst-case seg-cache heap retention is not bounded by the current character counter.",
    "Future fixture installs may silently select a different pi-tui release.",
    "A fully removed upstream hot path can remain permanently inapplicable under the current retirement gate."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the requested final plan review only; plan and source were not edited.",
  "reviewFindings": [
    "blocker: /tmp/pi-render-cache-plan-round3-clean.md:28-30,100-107 - exact core-theme allowlisting lacks a non-invoking runtime provenance discriminator",
    "blocker: src/seg-cache.js:55-66 and src/stats.js:19-50 - seg-cache memory cost counts only input characters, not retained keys/results/record objects",
    "high: /tmp/pi-render-cache-plan-round3-clean.md:37-56,134-136 - exact pi fixture installation does not freeze caret-resolved pi-tui",
    "blocker: /tmp/pi-render-cache-plan-round3-clean.md:83-85,156-164 - zero-work structural upstream fixes cannot satisfy retirement's active/nonzero contrast rule"
  ],
  "manualNotes": "Verdict: not mature enough as written. Strategic blockers: theme provenance, seg-cache memory contract, retirement logic. Mechanical gap: exact fixture locking."
}
```
