# Phase 5 conformance audit — delivered whole vs plan

## Verdict

**VERDICT: DEVIATING — maturity 6.5/10.**

The core patch lifecycle, deterministic correctness suite, theme fallback behavior, randomized process-block replay, byte-equality checks, and replay-delta RSS gate are implemented and pass. The delivered whole nevertheless does **not** match the full plan: the one-compatibility-unit contract is not enforced, fixture pi-tui integrities are absent, the benchmark evaluator omits the predeclared marginal patch contrasts, Checkpoints A/B do not execute the promised locked-fixture/matrix flow, the npm tarball retains script entries whose implementations are excluded, durable raw-artifact custody is not linked, and `release:verify` does not exist.

Status meanings: **SATISFIED** = promised acceptance is implemented and evidenced; **PARTIAL** = meaningful implementation exists but one or more promised conditions are absent; **MISSING** = the central promised condition/gate is absent or contradicted.

## Plan tasks and checkpoints

| Plan item | Status | Evidence and conformance assessment |
|---|---|---|
| **Task 1 — Portable resolver and isolated compatibility fixtures** | **PARTIAL** | The shared resolver honors `PI_PACKAGE_ROOT` and resolves pi-tui from the selected pi root (`scripts/resolve-pi.mjs:58-80,114-136`); `npm run compat:matrix` passed both 0.80.7 and 0.82.1 and printed exact versions, hashes, and canonical temporary realpaths. However, a tracked developer path remains at `docs/PLAN.md:77`. More importantly, both fixture lock records pin the nested pi-tui version and URL but have **no `integrity` field** (`fixtures/compat/0.80.7/package-lock.json:523-533`, `fixtures/compat/0.82.1/package-lock.json:524-534`), contrary to the frozen-version-and-integrity contract. `check-upstream` explicitly treats compatibility-table/version/hash matches as non-gating diagnostics (`scripts/check-upstream.mjs:11,159-193`), and it contains no type-resolution/coherence check. The project actually installs two physical pi-tui copies (`npm ls @earendil-works/pi-tui --all`: one direct and one nested), while `package.json:40-47` retains independent wildcard pi-tui peer plus direct dev dependency. Thus runtime/tests/typecheck realpath coherence is neither achieved nor attested. |
| **Task 2 — Patch lifecycle foundation** | **SATISFIED** | Independent setup decisions are implemented in `src/patch-state.js:72-149,161-188`; ownership loss preserves state and prevents layering (`src/md-cache.js:273-326`, `src/seg-cache.js:98-146`). Tests cover md-only failure, seg-only failure, both failures, foreign wrappers, ownership-loss reload, and repeated install/uninstall (`tests/extension.test.js:131-358`). `npm run verify` passed all 83 tests. `/rcstats` reports state/reason, ownership, versions, counters, and cache totals (`extensions/index.ts:71-94`). Minor presentation issue: totals are labeled `chars` rather than “estimated retained cost” at `extensions/index.ts:90-91`, despite README’s stronger wording. |
| **Task 3 — Deterministic replay and blocked benchmark engine** | **PARTIAL** | Four modes are run in fresh child processes with seeded within-block randomization (`scripts/benchmark.mjs:26,87-104`); worker timing uses `hrtime.bigint`, CPU samples, p95, and replay RSS deltas (`scripts/benchmark-worker.mjs:108-128,170-188,258-265`); every Markdown cut point is hashed and compared (`scripts/benchmark-worker.mjs:226-241`). The archived premise evaluator passed 60 complete blocks/240 runs with byte equality. But the evaluator computes only `baseline/mode` contrasts (`scripts/evaluate-benchmark.mjs:164-188`), not the promised marginal contrasts `combined/seg-only`, `md-only/baseline`, `combined/md-only`, and `seg-only/baseline`. Capabilities and mode-blind host-state disturbance diagnostics/rejection rules are also not archived/implemented as promised. RSS “peak” is sampled only after each complete repetition (`scripts/benchmark-worker.mjs:170-182`), not during synchronous replay updates. |
| **Checkpoint A — Executable premise gate** | **PARTIAL** | `node scripts/evaluate-benchmark.mjs --mode premise --input .bench-results/premise-raw.json` passed schema, structural hot paths, one-unit metadata, 20 blocks per workload, all 240 byte-equal runs, ownership/activity, and styled fallback; memory remained report-only. However, `premise` does not install/select the locked 0.82.1 fixture: it resolves whichever local/global pi is current, and its package script fixes the raw output path (`package.json:56`). The planned `--pi 0.82.1 --output ...` orchestration is not parsed or implemented. Therefore the archived run is a 0.82.1 run, but not an executable locked-fixture premise flow. |
| **Task 4 — Cache bounds and unstyled theme key** | **PARTIAL** | Safety-critical behavior is strong: non-null style/non-empty options return through original rendering before theme analysis (`src/md-cache.js:188-197`); exact own-key/source gating and bounded repeated output probes cover the renderer-consumed surface (`src/md-cache.js:48-166`); key framing includes text, width, padding, signature, output fingerprint, and hyperlink capability (`src/md-cache.js:223-231`). Tests cover source-mismatch zero callback calls, mutable extra-key fallback, palette/theme changes, counter-stateful and throw-once boundaries (`tests/md-cache.test.js:337-370,376-520`), plus cache activity/fuzz and high-segment bounds (`tests/md-cache.test.js:624-647,666-765`; `tests/seg-cache.test.js:119-185`). Hard per-entry/total bounds exist. Formal gaps remain: no explicit key collision/NUL-framing regression or injected capability-change test exists; seg accounting charges per-record overhead but omits an explicit fixed result-wrapper/array overhead (`src/seg-cache.js:15,80-86`); `/rcstats` labels retained estimates as `chars`. |
| **Task 5 — Deterministic correctness suite** | **SATISFIED** | `npm test` has no wall-clock speed ratio assertion; grep found no timing API/ratio assertions in tests. The suite retains byte equality, activity, eviction, ownership, fallbacks, bounded deterministic fuzz, and prints seed plus the complete failing document (`tests/md-cache.test.js:685-765`). `npm run verify` passed 83/83 tests. |
| **Checkpoint B — Executable release-feasibility gate** | **PARTIAL** | `node scripts/release-feasibility.mjs --input .bench-results/premise-raw.json --output /tmp/pi-render-cache-feasibility-audit.json` passed tests, premise gates, and all nine paired replay-peak RSS checks (worst +3.45 MiB, below +20 MiB), producing machine-readable output and a nonzero-on-failure design. But the gate runs only `npm test`, the selected-root `check-upstream`, benchmark/evaluator, and RSS checks (`scripts/release-feasibility.mjs:93-140`); it does **not** run the promised compatibility matrix. Thus “compatibility matrix ... all pass with machine-readable evidence” is not part of Checkpoint B itself. |
| **Task 6 — Reproducible setup, CI, package validation, evidence promotion** | **PARTIAL** | Node is pinned to `>=22.19.0` (`package.json:37-38`), default dev versions are exact, CI uses Node 22.19 and `npm ci` (`.github/workflows/ci.yml:15-29`), `verify`/`prepublishOnly` share the canonical gate (`package.json:58,62`), `.bench-results/` is ignored, check-pack passes, and promoted evidence records raw/corpus hashes (`evidence/v1.1.0/summary.json:3-15`). The allowed scope deferral for 0.80.7 is respected by keeping the full matrix on-demand (`.github/workflows/ci.yml:30-32`). But the tarball’s 14-file allowlist ships only two scripts while the shipped `package.json` retains commands for absent `tests/`, `benchmark.mjs`, `evaluate-benchmark.mjs`, `install-fixture.mjs`, `release-feasibility.mjs`, and `check-pack.mjs` (`package.json:20-29,49-62`; `npm pack --json --dry-run` file list). Hence the manifest is exact but not closed over advertised scripts/fixtures. The independent wildcard pi-tui peer and duplicate physical copies also violate the compatibility-unit resolution decision. Raw evidence custody is described, but no immutable artifact URL is recorded (`evidence/README.md:3-13`; `docs/UPSTREAM_STATUS.md:31-33`). |
| **Task 7 — Controlled release validation and documentation** | **PARTIAL** | README/status documentation reconciles the 83 tests, controlled-vs-ecological distinction, compatibility states, styled-thinking limitation, upstream issues, evidence summary, and independent retirement language (`README.md:41-65,91-107,121-143`; `docs/UPSTREAM_STATUS.md:3-48`). Version is bumped to 1.1.0. The central executable acceptance is absent: `package.json:49-62` has no `release:verify` script, so the required matrix + canonical verify + 20-block replay + evaluator + evidence promotion + pack sequence cannot be invoked. There is also no immutable raw artifact URL, and the package exposes scripts whose files are not shipped. |

## Safety decisions

| Safety decision | Status | Evidence |
|---|---|---|
| **1. No arbitrary styled-callback caching** | **SATISFIED** | `defaultTextStyle != null` falls back before split/theme classification (`src/md-cache.js:188-197`). The independent callback-count test proves zero added probes for styled rendering (`tests/md-cache.test.js:547-568`). Thinking benchmark runs report md fallbacks and evaluator gates them (`scripts/evaluate-benchmark.mjs:306-313`). |
| **2. Explicit core-theme compatibility contract, not provenance/authentication** | **SATISFIED** | Exact own-key and `Function.prototype.toString()` hashes gate support (`src/md-cache.js:84-107`); bounded complete-surface repeat probes generate the fingerprint (`src/md-cache.js:115-166`); comments/docs explicitly limit matching callbacks to deterministic, side-effect-free, input-transparent behavior (`src/md-cache.js:8-14`; `README.md:108-110,143`). Ordinary non-matching callbacks are not invoked by classification, proven at `tests/md-cache.test.js:337-370`. The bounded counter and throw-once unsupported fixtures are present (`tests/md-cache.test.js:484-520`). |
| **3. One selected pi + physically nested/resolved pi-tui compatibility unit** | **MISSING** | Resolver-based tests/diagnostics do select nested pi-tui, but the extension uses a bare pi-tui import and the package retains an independent wildcard peer/direct dev dependency (`extensions/index.ts:22-24`; `package.json:40-47`). `npm ls` shows two physical 0.82.1 copies. No matrix/type-resolution check fails on this divergence. This directly contradicts the “no independently selected pi-tui” contract. |
| **4. Blocked, paired performance evidence with no correctness-CI speed ratio** | **PARTIAL** | Fresh process randomized complete blocks and whole-block bootstrap inference are implemented (`scripts/benchmark.mjs:87-104`; `scripts/benchmark-lib.mjs:46-67`), and generic correctness tests contain no speed threshold. However, required marginal patch contrasts are absent from the evaluator; only baseline-vs-mode ratios exist (`scripts/evaluate-benchmark.mjs:168-188`). |

## Compatibility contract cross-check

| Contract element | Status | Evidence |
|---|---|---|
| pi 0.80.7 → nested pi-tui 0.80.7, Node >=22.19, both expected active | **PARTIAL** | `compatibility.json:3-10` and fixture version at `fixtures/compat/0.80.7/package-lock.json:523-533` agree; matrix passed version/hash/canaries. Nested pi-tui integrity is absent, and matrix does not exercise md lifecycle/theme activation or make hash/table mismatches gating. |
| pi 0.82.1 → nested pi-tui 0.82.1, Node >=22.19, both expected active | **PARTIAL** | `compatibility.json:3,11-18` and fixture version at `fixtures/compat/0.82.1/package-lock.json:524-534` agree; matrix and archived premise activity passed. Nested pi-tui integrity is absent, and default project resolution has direct+nested copies. |
| Other/future → selected pi’s resolved pi-tui; md unsupported until allowlisted; seg conditional on native canary | **PARTIAL** | Independent lifecycle code implements unknown md rejection and seg canary (`src/patch-state.js:72-149`), matching README table (`README.md:91-101`). Independent pi-tui peer resolution remains possible and unverified, undermining the unit guarantee. |

## End-of-plan `## Verification` checklist

| Verification checkbox | Status | Evidence |
|---|---|---|
| No hard-coded developer path | **MISSING** | Tracked `docs/PLAN.md:77` contains `/Users/shamash/...`. Source/runtime files are otherwise portable. |
| Exact pi/pi-tui/Node compatibility table and isolated matrix pass | **PARTIAL** | Matrix passed both exact version pairs on Node 22.23, but pi-tui lock integrities are missing, table/hash checks are diagnostic, and type/runtime copy coherence is not checked. |
| Independent patch states and ownership-loss tests pass without layering | **SATISFIED** | 83-test verify pass; lifecycle cases at `tests/extension.test.js:131-358`. |
| `npm test` has no timing ratios | **SATISFIED** | Test scan found no wall-clock ratio assertions; `npm run verify` passed. |
| Replay uses complete randomized process blocks and whole-block inference | **SATISFIED** | `scripts/benchmark.mjs:87-104`; `scripts/benchmark-lib.mjs:46-67`; evaluator passed 60 structurally complete blocks. Missing marginal contrasts are recorded separately as a deviation. |
| Every intermediate output is byte-identical | **SATISFIED** | Premise evaluator: `PASS all runs byte-identical at every replay cut point — 240 runs`; implementation at `scripts/benchmark-worker.mjs:226-241`. |
| Styled and non-matching custom themes pristine fallback with zero classification calls; matching contract documented | **SATISFIED** | `src/md-cache.js:188-220`; tests at `tests/md-cache.test.js:337-370,547-568`; contract at `README.md:108-110,141-143`. |
| Complete supported-theme key has mutation/collision regressions and both caches pass worst-case retained-cost limits | **PARTIAL** | Theme/palette mutation and worst-case cache tests exist, but no explicit framing/collision or injected capability-change regression was found; seg fixed wrapper/array overhead is not separately charged. |
| RSS evidence uses replay deltas, not lifetime maxRSS | **SATISFIED** | `scripts/benchmark-worker.mjs:258-265`; Checkpoint B passed paired replay-peak deltas. `maxRSS` is supplementary only. |
| Checkpoints A/B and release gate executable with nonzero failure codes | **PARTIAL** | A and B are executable and passed; `release:verify` is missing from `package.json:49-62`. A also does not select/install the promised locked fixture. |
| Exact tarball manifest includes all advertised scripts/docs/image choice | **MISSING** | `npm run check-pack` passes 14 files, including docs/image, but shipped `package.json` exposes multiple commands whose scripts/tests/fixtures are excluded (`package.json:20-29,49-62`). |
| Durable evidence links and hashes exist | **PARTIAL** | Tracked summary has raw/corpus/output/environment data and hashes (`evidence/v1.1.0/summary.json`), and docs link the tagged summary; no immutable raw CI artifact URL exists. |
| Retirement is independent, paired, environment-scoped, and three-outcome | **PARTIAL** | Documentation states both independent routes, non-pooling, paired CIs, `[0.95,1.05]`, and three outcomes (`docs/UPSTREAM_STATUS.md:37-48`). The full retirement campaign is correctly deferred by scope, but the already-promised marginal-contrast evaluator support is missing, so the protocol is not executable as written. |

## Scope notes and non-goals

### Deferred scope honored

- The full future-upstream retirement campaign was not run; this is an explicit P2 deferral, not counted as missing execution.
- 0.80.7 is retained as an on-demand matrix entry (`.github/workflows/ci.yml:30-32`), exactly as the scope note allows.
- The two bounded matching-but-stateful fixtures are present: one counter and one throw-once (`tests/md-cache.test.js:484-520`).
- This v1.1.0 change alters runtime behavior, so the docs-only exemption does **not** excuse the absent `release:verify` flow.

### Non-goals respected

- **No message-update throttling, viewport patch, or AssistantMessageComponent monkey-patch:** implementation scan of `src/`, `extensions/`, `scripts/`, and `tests/` found none.
- **No arbitrary callback-purity claim/probing:** only exact allowlisted core-signature callbacks receive bounded compatibility fingerprint probes; styled callbacks bypass before probing.
- **No generic-CI speed threshold:** correctness/verify has none; quick benchmark is informational and `continue-on-error` (`.github/workflows/ci.yml:34-54`).
- **No claim #7017/#7082 shipped:** both are described as closed without merge (`docs/UPSTREAM_STATUS.md:10-12`).
- **No use of #6792 as core-performance evidence:** explicitly excluded (`docs/UPSTREAM_STATUS.md:13`).

## Deviations, ordered by severity

1. **HIGH — one-compatibility-unit safety contract is not enforced.** `package.json:40-47` keeps an independent wildcard pi-tui peer/direct dev dependency; `npm ls` shows direct and nested physical copies; matrix/typecheck do not attest coherence. The extension may be typechecked/resolved against a copy different from the selected pi’s runtime copy.
2. **HIGH — release gate promised by Task 7 is absent.** No `release:verify` command exists (`package.json:49-62`), so there is no single nonzero-failing gate combining exact fixtures, canonical verify, 20-block controlled replay, evaluator, evidence promotion, and pack validation.
3. **HIGH — shipped package scripts are not closed over the tarball.** The 14-file tarball excludes tests, fixtures, and most scripts, while its `package.json` retains commands referencing them (`package.json:20-29,49-62`). `check-pack` validates exactness, not executability/advertising consistency.
4. **MEDIUM — retirement/release statistics omit required marginal patch contrasts.** `scripts/evaluate-benchmark.mjs:168-188` calculates only baseline-vs-mode contrasts, so the predeclared per-patch `combined/seg-only`, `md-only/baseline`, `combined/md-only`, and `seg-only/baseline` protocol is not implemented.
5. **MEDIUM — fixture attestation is weaker than promised.** Nested pi-tui records have no integrity (`fixtures/compat/0.80.7/package-lock.json:523-533`; `fixtures/compat/0.82.1/package-lock.json:524-534`), and compatibility/hash matches are diagnostic rather than gating (`scripts/check-upstream.mjs:159-193`).
6. **MEDIUM — Checkpoint A does not install/select locked 0.82.1.** `package.json:56` benchmarks the currently resolved installation and ignores the planned `--pi` orchestration.
7. **MEDIUM — Checkpoint B omits compatibility matrix evidence.** `scripts/release-feasibility.mjs:93-103` runs only current-root tests/canaries before benchmark evaluation.
8. **MEDIUM — durable raw evidence custody is incomplete.** Summary hashes exist, but no immutable raw artifact URL is linked (`evidence/README.md:3-13`; `docs/UPSTREAM_STATUS.md:31-33`).
9. **LOW — verification/documentation polish gaps.** A tracked hard-coded developer path remains (`docs/PLAN.md:77`); explicit collision/capability-key regressions were not found; `/rcstats` labels estimates as `chars` (`extensions/index.ts:90-91`).

## Commands run

- `npm run verify` — **PASS**: 83/83 tests, typecheck, selected 0.82.1 compatibility canaries/hashes, exact 14-file pack manifest.
- `npm run compat:matrix` — **PASS**: isolated npm-ci fixtures for 0.80.7 and 0.82.1; exact observed pi/pi-tui versions and hashes.
- `npm run check-pack` — **PASS**: exact 14-file manifest.
- `node scripts/evaluate-benchmark.mjs --mode premise --input .bench-results/premise-raw.json` — **PASS**: 20 complete blocks for each of three workloads, 240 byte-identical runs, activity/ownership/fallback gates.
- `node scripts/release-feasibility.mjs --input .bench-results/premise-raw.json --output /tmp/pi-render-cache-feasibility-audit.json` — **PASS**: deterministic tests, premise, and all +20 MiB paired replay-peak RSS gates.
- `npm ls @earendil-works/pi-tui --all` — **PASS command, adverse evidence**: revealed one direct and one nested physical pi-tui copy.
- `npm pack --json --dry-run` — **PASS command, adverse evidence**: confirmed only 14 files and absence of most script targets/fixtures/tests.
- `npm ci` — **not run** to preserve the requested read-only working tree; CI configuration and existing lock were inspected, while `compat:matrix` performed isolated `npm ci` runs in temporary roots.

## Residual risks

- The bare pi-tui extension import can diverge from the selected pi root in installation layouts with multiple copies; current same-version local success does not prove identity.
- Published npm consumers can invoke retained package scripts that fail because their target files are absent.
- Evidence claims cannot be independently tied to an immutable raw artifact using a documented URL.
- Future retirement decisions cannot use the plan’s required marginal patch contrasts without additional evaluator work.
- Compatibility-table drift can remain a warning while matrix exits successfully.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete severity-ranked findings cite package.json:40-62, scripts/evaluate-benchmark.mjs:168-188, scripts/release-feasibility.mjs:93-140, fixture lockfile lines, command outputs, and residual risks."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/FINAL_audit_2.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm run verify",
      "result": "passed",
      "summary": "83 tests, typecheck, selected compatibility check, and exact pack check passed."
    },
    {
      "command": "npm run compat:matrix",
      "result": "passed",
      "summary": "Isolated 0.80.7 and 0.82.1 fixtures installed and reported matching versions/hashes."
    },
    {
      "command": "npm run check-pack",
      "result": "passed",
      "summary": "Exact 14-file tarball manifest passed; audit found excluded targets for retained package scripts."
    },
    {
      "command": "node scripts/evaluate-benchmark.mjs --mode premise --input .bench-results/premise-raw.json",
      "result": "passed",
      "summary": "60 complete blocks and 240 byte-identical runs passed structural/activity gates."
    },
    {
      "command": "node scripts/release-feasibility.mjs --input .bench-results/premise-raw.json --output /tmp/pi-render-cache-feasibility-audit.json",
      "result": "passed",
      "summary": "Checkpoint B implementation passed tests, premise, and all paired +20 MiB replay-peak RSS checks."
    },
    {
      "command": "npm run release:verify",
      "result": "not-run",
      "summary": "Command is missing from package.json."
    },
    {
      "command": "npm ci",
      "result": "not-run",
      "summary": "Skipped to preserve read-only project state; isolated fixture npm ci runs did execute via compat:matrix."
    }
  ],
  "validationOutput": [
    "npm run verify: 83/83 tests passed; typecheck and selected compatibility passed.",
    "compat:matrix: both 0.80.7 and 0.82.1 passed, but nested pi-tui lock entries lack integrity fields.",
    "premise evaluator: 20 complete blocks per workload, 240 byte-identical runs, PREMiSE PASS.",
    "release feasibility: all nine paired replay-peak RSS gates passed; worst median +3.45 MiB.",
    "npm ls: direct and nested pi-tui 0.82.1 copies are simultaneously installed.",
    "npm pack dry-run: 14 files; most retained package script targets are absent."
  ],
  "residualRisks": [
    "pi-tui runtime/type identity is not enforced across duplicate physical copies.",
    "Published package retains commands whose target scripts/tests/fixtures are absent.",
    "Raw benchmark evidence has no linked immutable artifact URL.",
    "Required marginal patch contrasts are unavailable for retirement decisions.",
    "Compatibility drift can remain diagnostic while matrix exits successfully."
  ],
  "noStagedFiles": true,
  "diffSummary": "Large hardening delivery adds lifecycle isolation, bounded theme/cache behavior, deterministic tests, blocked replay, evidence/docs, CI, and pack validation, but omits or weakens several promised compatibility, release, packaging, and retirement controls.",
  "reviewFindings": [
    "high: package.json:40-47 - independent wildcard/direct pi-tui dependency leaves two physical copies and violates the one-unit safety contract.",
    "high: package.json:49-62 - release:verify is missing, so Task 7's controlled release gate is not executable.",
    "high: package.json:20-29,49-62 - tarball excludes targets for multiple retained npm scripts.",
    "medium: scripts/evaluate-benchmark.mjs:168-188 - required marginal per-patch contrasts are not implemented.",
    "medium: fixtures/compat/0.80.7/package-lock.json:523-533 and fixtures/compat/0.82.1/package-lock.json:524-534 - nested pi-tui integrity is not frozen.",
    "medium: scripts/release-feasibility.mjs:93-103 - Checkpoint B omits the promised compatibility matrix.",
    "medium: package.json:56 - premise does not select/install the locked 0.82.1 fixture.",
    "low: docs/PLAN.md:77 - tracked hard-coded developer path remains."
  ],
  "manualNotes": "Overall verdict: DEVIATING, maturity 6.5/10. Core correctness is strong; release/compatibility/package conformance is incomplete."
}
```
