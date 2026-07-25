# Blind implementation-plan review

## 1) Errors by severity

### BLOCKER — the proposed `defaultTextStyle.color` analysis cannot preserve byte identity for arbitrary callbacks

**Plan references:** Task 2 steps 4–6 (`/tmp/pi-render-cache-plan-clean.md:54-56`); Task 3 steps 2–6 (`:66-70`); verification claim at `:140`.

The design executes an unknown callback repeatedly on sentinels, then promises that a callback found unsafe will “fall back to pristine rendering.” That fallback is already observably contaminated by the probes. For example, with `color = s => `${++calls}:${s}``, the probes advance `calls`; after disagreement is detected, `orig.call(this, width)` starts from a later state than an unprobed pristine render and can return different bytes. The same applies to side effects and callbacks that throw conditionally. Repeated probing detects some instability only after changing the state whose behavior the fallback is supposed to preserve.

Even for side-effect-free callbacks, a finite sentinel fingerprint is not a proof of equivalence. Two callbacks can return identical results for every chosen sentinel yet differ for an actual Markdown line; they then collide in the global prefix key and one can receive the other’s cached ANSI. Passing the exact style object to scratch `Markdown` instances (`src/md-cache.js:107-121` is the construction point to be changed) does not fix cache hits, because a hit does not invoke the callback for the cached settled text.

**Required plan correction:** do not invoke an untrusted callback merely to decide whether to fall back. A byte-identity-safe design can cache boolean-only styles and leave unknown `color` callbacks on the untouched original path. Supporting colored thinking requires a non-probing trust mechanism: for example, an explicitly recognized canonical callback/provenance plus an authoritative theme/version key, with every other function falling back without invocation. Callback identity should also be part of isolation, but identity alone does not make a stateful callback cache-safe. Add a regression test whose counter/state is checked as well as output bytes, and a pair of callbacks that agree on all probes but diverge on document text.

### HIGH — fresh-process upstream drift is not covered by the proposed compatibility hardening

**Plan references:** Task 5 acceptance and steps 1–4 (`/tmp/pi-render-cache-plan-clean.md:87-93`). **Source:** `extensions/index.ts:39-53`; `src/md-cache.js:138-153`.

The current runtime drift guard works only when shared md state already exists (`extensions/index.ts:43-49`). On a fresh process, any replaced or incompatible `Markdown.prototype.render` is captured as `orig` and patched (`src/md-cache.js:141-153`). Task 1’s CLI compatibility report does not protect normal extension startup, and Task 5 asks for a replacement test without specifying the runtime structural/version gate that would make it pass. Therefore the acceptance statement “on upstream drift the affected patch disables cleanly” is not implementable from the listed steps as written.

Add an explicit runtime pre-install compatibility check for each patch, including the no-existing-state case, and define what constitutes compatible wrapping versus disabling. The Markdown failure path must still allow Segmenter installation; currently the drift branch returns before `installSeg()` (`extensions/index.ts:45-52`).

### HIGH — clean-checkout tests remain tied to one developer’s absolute global installation

**Plan references:** Task 1 acceptance (`/tmp/pi-render-cache-plan-clean.md:36-40`); Task 6 acceptance and step 3 (`:99-104`). **Source:** `tests/helpers.js:6-12`.

`tests/helpers.js` hard-codes `/Users/shamash/local/lib/node_modules/...`. A lockfile and local `typescript` do not make `npm test` portable while all Markdown tests import through that path. Although Task 2 lists `tests/helpers.js`, it gives no step to replace these paths; Task 6 does not list the helper at all. A clean checkout on another machine therefore cannot meet Task 6 acceptance.

Resolve the pi package from the project’s installed peer/dev dependency and resolve pi-tui/theme relative to that resolved pi instance (the same-instance invariant), with a clear diagnostic if the peer is absent. Make this an explicit Task 1/6 deliverable and test it without the absolute path.

### MEDIUM — the plan leaves an existing brittle hard performance failure in CI

**Plan references:** Task 1 step 5 (`/tmp/pi-render-cache-plan-clean.md:43`) and Task 4 step 3 (`:81`). **Source:** `tests/md-cache.test.js:398-432`; `package.json:44-48`.

The plan says performance ratios must not hard-fail on noisy machines and calls the new styled threshold “soft,” but the existing test unconditionally asserts at least 5× and is included by `npm test`. No task says to remove, relocate, or convert that assertion. `npm run verify` would therefore retain exactly the brittle CI behavior Task 1 rejects. Explicitly convert both ordinary and styled thresholds to benchmark reporting (or an opt-in performance job) while retaining correctness/counter assertions in the deterministic test suite.

### MEDIUM — the package-content acceptance is literally impossible and conflicts with the new user document

**Plan references:** verification checklist (`/tmp/pi-render-cache-plan-clean.md:142`); Task 7 files/acceptance (`:108-118`). **Source:** `package.json:20-25`.

`npm pack` always includes `package.json`, so “contains only `extensions/`, `src/`, `README.md`, and `LICENSE`” cannot pass literally. Also, `docs/UPSTREAM_STATUS.md` is not in the current `files` allowlist, so an npm user cannot read a relative README link to the support/retirement document unless its essential contents are duplicated in README or the file is deliberately published.

Define the exact expected tarball including mandatory npm metadata, and either include `docs/UPSTREAM_STATUS.md` in `files` or require README to contain the complete user-facing status and retirement information.

## 2) Missing work

1. **A non-invasive trust boundary for color callbacks.** The plan needs an implementable rule for recognizing the canonical thinking callback without executing arbitrary callbacks. Until that exists, colored styles must remain fallback-only; boolean decorations can be supported safely.
2. **Adversarial safety assertions must cover side effects, not only rendered arrays.** Add callback invocation-count/state assertions and probe-collision callbacks. Output-only differential tests can miss the fact that analysis performed extra calls.
3. **Fresh-start compatibility tests.** Test an incompatible `Markdown.render` and Segmenter implementation before any cache state exists, then assert only the affected patch is absent and the other remains installed. Existing tests cover state/reinstall scenarios (`tests/extension.test.js`) but not this startup contract.
4. **Portable module resolution.** Replace `tests/helpers.js:6-12` and ensure the benchmark, compat script, tests, and extension all target the same physical pi-tui module.
5. **Explicit removal/conversion of the existing ≥5× hard test** at `tests/md-cache.test.js:400-431`.
6. **A precise tarball manifest** and a decision on publishing `docs/UPSTREAM_STATUS.md`.

## 3) Doubtful assumptions

- **“Repeated probes” imply purity/transparency.** They do not: a deterministic function can branch on unprobed input or mutable state that does not affect the sentinels. This is the central unsafe assumption.
- **Fallback after analysis is pristine.** It is only pristine if analysis has not invoked user behavior. The planned analyzer violates that premise.
- **Fingerprint evaluation occurs on every render.** The current per-instance fast path returns before any theme/style fingerprint work (`src/md-cache.js:61-65`). If same-instance theme/style changes are in scope, the plan must say whether invalidation is required or whether style/theme state joins per-instance coherence. The proposed theme-switch tests should exercise this explicitly rather than only fresh instances.
- **Zero runtime activity is a health signal.** The current timer disables both patches when md counters stay at zero (`extensions/index.ts:55-68`). Splitting that into two zero-activity checks would still confuse “not exercised yet” with “incompatible.” Structural/ownership checks should decide compatibility; counters should remain observability, not proof of failure.
- **Best-of-N establishes a meaningful speedup.** It is useful for local reporting but is not statistical significance. This is acceptable for a soft benchmark only if the retirement wording does not claim significance without repeated distributions and variance/confidence criteria.

## 4) Verdict

**NO-GO — maturity 5/10.**

The overall sequencing, independent-cache goal, differential/fuzz coverage, and manual validation are directionally strong. However, the central styled-color safety mechanism cannot meet the promised byte-identity/fallback contract, and fresh-process drift plus clean-checkout resolution are underspecified. Proceed only after redesigning callback safety around non-invasive recognition/fallback and adding the missing portability/runtime gates.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete severity-ranked findings cite /tmp/pi-render-cache-plan-clean.md, src/md-cache.js, extensions/index.ts, tests/helpers.js, tests/md-cache.test.js, tests/extension.test.js, and package.json; residual risks and a NO-GO verdict are included."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/BLIND_review_1.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Read /tmp/pi-render-cache-plan-clean.md and only plan-named current source/test/package files; inspect cited ranges with nl/sed",
      "result": "passed",
      "summary": "Verified plan claims against current md-cache, extension startup, test helpers, performance test, and package manifest."
    }
  ],
  "validationOutput": [
    "Identified one blocker, two high-severity errors, two medium-severity errors, six missing-work items, and five doubtful assumptions.",
    "No project source, tests, package metadata, or plan files were modified."
  ],
  "residualRisks": [
    "The external pi-tui implementation was intentionally not inspected under the review scope, so canonical callback provenance must be verified during redesign.",
    "No tests were run because this was a plan-only review; findings are based on the scoped plan and current named files."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested blind plan-review artifact; no implementation files changed.",
  "reviewFindings": [
    "blocker: /tmp/pi-render-cache-plan-clean.md:67-70 - probing arbitrary style callbacks is state-mutating and finite fingerprints cannot guarantee byte-safe cache equivalence",
    "high: extensions/index.ts:39-53 - fresh-process upstream replacement is not detected before patch installation",
    "high: tests/helpers.js:6-12 - absolute developer paths prevent clean-checkout verification",
    "medium: tests/md-cache.test.js:398-432 - existing hard 5x CI gate contradicts the planned soft benchmark policy",
    "medium: package.json:20-25 and plan verification line 142 - literal tarball criterion omits mandatory package.json and excludes the new support document"
  ],
  "manualNotes": "Review was restricted to the clean plan and files explicitly named by it, as requested."
}
```
