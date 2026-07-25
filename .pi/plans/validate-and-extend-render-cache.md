# Validate and harden pi-render-cache after upstream changes

## Context

As of 2026-07-25, pi `0.82.1` (`b4f293684bba718d59cc1157679bcf6157b3a7f5`) and upstream `main` still contain both hot paths from issue #6665:

- streaming `message_update` calls `AssistantMessageComponent.updateContent()`;
- `updateContent()` clears the content container and constructs fresh `Markdown` instances;
- Unicode wrapping/truncation repeatedly calls `Intl.Segmenter`; pi has a 512-entry final-width cache, not a segmentation-result cache.

The apparent upstream fixes do not supersede this package:

- PR #7017 was closed without merge and limits terminal output only after component rendering;
- PR #7082 was closed without merge and targets outer transcript/per-keystroke work; it may reduce other frame costs but does not remove the inner Markdown rebuild or segmentation calls;
- issue #6792 was attributed by its reporter to another extension and is not evidence for #6665.

Preliminary local observations on Apple M3, Node 22.23, pi `0.82.1` (not release evidence until reproduced by the checked-in harness):

- 64/64 existing tests pass;
- ordinary 10 KB streaming proxy: about 821–1031 ms baseline vs 22–25 ms with both caches;
- distinct Unicode-line proxy: about 1.6–1.9 s baseline vs 0.49–0.75 s with both caches;
- styled thinking proxy: about 649 ms baseline vs 314 ms patched; `md-cache` falls back because `defaultTextStyle` is present, so only `seg-cache` helps.

The extension remains useful, but the project has maintenance gaps: hard-coded developer paths, timing assertions in correctness tests, partial fresh-start upgrade guards, all-or-nothing self-disable behavior, wildcard compatibility metadata, and no reproducible release/retirement protocol.

## Safety decisions

1. **No arbitrary styled-callback caching.** Finite probing cannot prove a JavaScript callback pure and may itself mutate state or change exception timing before fallback. Every non-null `defaultTextStyle` remains on untouched original rendering. Styled thinking receives only the `seg-cache` benefit. A future upstream pure-style token/API is a separate project.
2. **Theme support has an explicit behavioral contract, not an impossible provenance claim.** Pi creates a fresh Markdown theme object on every streaming rebuild, so identity keys destroy cross-instance hits, and the host exposes no stable theme brand/generation token. Runtime provenance therefore cannot be proven. `md-cache` accepts only themes whose complete shape and function-source signatures match an allowlisted core implementation, then fingerprints bounded outputs from the complete renderer-consumed surface. This is compatibility gating, not authentication: callers that deliberately spoof the core signature or supply stateful/non-deterministic callbacks are unsupported. Ordinary non-matching custom themes fall back without analysis calls. Tests document this boundary rather than claiming arbitrary callback purity.
3. **One compatibility unit.** A selected `@earendil-works/pi-coding-agent` installation and its physically nested/resolved `@earendil-works/pi-tui` form one tested unit. No independently selected pi-tui version is supported.
4. **Performance evidence is blocked and paired.** Correctness CI has no speed ratio. Release/retirement uses fresh child processes grouped into randomized complete blocks and evaluates within-block contrasts.

## Compatibility contract

Initial checked-in table:

| pi | pi-tui compatibility unit | Node | md-cache | seg-cache |
|---|---|---|---|---|
| `0.80.7` | exact transitive pi-tui version + integrity frozen in fixture lock | `>=22.19` | expected active after canaries | expected active after canaries |
| `0.82.1` | exact transitive pi-tui version + integrity frozen in fixture lock | `>=22.19` | expected active after canaries | expected active after canaries |
| other/future | resolved from selected pi root | host-compatible Node | unsupported until added | active only if native Segmenter canary passes |

The matrix script installs each fixture from a checked-in per-fixture lock containing exact pi and transitive pi-tui versions/integrities, verifies hashes/realpaths, and passes that isolated root through `PI_PACKAGE_ROOT`. `package.json` retains pi-coding-agent as the peer and removes the independent pi-tui peer/dev wildcard if type resolution confirms it is unnecessary; otherwise every matrix fixture pins the same locked pi-tui and the resolver verifies type/runtime realpath coherence.

## Tasks

### Task 1: Portable resolver and isolated compatibility fixtures
**Files:** `scripts/resolve-pi.mjs`, `scripts/install-fixture.mjs`, `scripts/check-upstream.mjs`, `compatibility.json`, `fixtures/compat/0.80.7/{package.json,package-lock.json}`, `fixtures/compat/0.82.1/{package.json,package-lock.json}`, `tests/helpers.js`, `package.json`
**Acceptance:** No `/Users/shamash/...` path remains; every check uses one selected pi root and its pi-tui; isolated fixtures for `0.80.7` and `0.82.1` report exact versions, implementation hashes, and canonical realpaths.
**Verify:** `npm run compat:matrix`
**Steps:**
1. Implement one resolver with explicit `PI_PACKAGE_ROOT`; resolve pi-tui/theme relative to that selected pi package.
2. Replace absolute test paths and produce an actionable error when the selected peer is absent.
3. Add `compatibility.json` with exact pi/pi-tui pairs, required Node range, expected per-patch states, and allowlisted core implementation hashes.
4. Check in minimal per-fixture lockfiles freezing transitive versions and integrities. `install-fixture.mjs` installs from each lock with `npm ci` into an isolated temporary root; never mutate the working tree dependency graph.
5. Report pi/pi-tui versions, Node/ICU/platform, realpaths, source hashes, and type-resolution paths. Fail if runtime/tests/typecheck use different pi-tui copies.
6. Run structural diagnostics plus minimal differential canaries; signatures remain diagnostic, while allowlist + canaries decide support.
7. Add JSON-only `--json`; summaries use stderr/default human mode.

### Task 2: Patch lifecycle foundation
**Files:** `src/patch-state.js`, `src/md-cache.js`, `src/seg-cache.js`, `extensions/index.ts`, `tests/extension.test.js`
**Depends:** Task 1
**Acceptance:** Each patch independently reports `active`, `unsupported`, or `ownership-lost`; one failure never removes the other; no reload layers a wrapper over an untracked old patch.
**Verify:** `node --test tests/extension.test.js tests/smoke.test.js`
**Steps:**
1. Replace zero-activity self-disable with explicit compatibility and ownership state. Counters are observability only.
2. On fresh start, unknown Markdown implementation/theme implementation leaves md-cache unsupported; Segmenter is evaluated independently.
3. Preserve global state on ownership loss. Do not report uninstall, delete bookkeeping, or reinstall while a foreign wrapper may call the old patch; report restart/manual removal required.
4. Add integration/controller tests for md-only failure, seg-only failure, both failures, fresh incompatible methods, foreign wrapper calling ours, ownership loss then reload, and repeated install/uninstall.
5. Make `/rcstats` report per-patch state/reason, ownership, selected pi/pi-tui versions, counters, and memory.

### Task 3: Deterministic replay and blocked benchmark engine
**Files:** `scripts/benchmark.mjs`, `scripts/benchmark-worker.mjs`, `scripts/evaluate-benchmark.mjs`, `fixtures/stream-replay.json`, `package.json`, `.gitignore`
**Depends:** Tasks 1–2
**Acceptance:** Baseline, seg-only, md-only, and combined modes run as fresh child processes over identical data; results contain complete randomized blocks, raw samples, byte-equality, patch activity, and environment metadata; generic CI does not fail on speed.
**Verify:** `npm run benchmark -- --output .bench-results/latest.json && npm run benchmark:evaluate -- --mode premise --input .bench-results/latest.json`
**Steps:**
1. Add sanitized deterministic replays for ordinary Markdown, styled thinking, and Unicode-width/long-transcript work with fixed chunk boundaries. Cadence controls operation order only and is excluded from synchronous render latency.
2. Define one independent block as all four modes for one workload/host state, each in an isolated child process. Randomize mode order within each block with a recorded fixed seed; child threads are forbidden.
3. Warm identical corpora outside timing. Measure synchronous render/update work with `hrtime.bigint`, process CPU, run-total wall work, and within-run p95 update latency; GC pauses remain included.
4. Memory: after standardized warmup and optional documented `--expose-gc` policy, sample `memoryUsage().rss()` before, during, and after replay. Record pre-replay, replay peak, retained end, and deltas. Lifetime `maxRSS` is supplementary only.
5. Run a fixed minimum of 20 complete blocks for release evidence (pilot may increase the predeclared count before the final run; no optional stopping afterward). Archive all samples and mode order.
6. Evaluate within-block log ratios using baseline denominator. Resample whole blocks with a fixed-seed percentile bootstrap (10,000 replicates); never resample chunks or compare marginal CIs.
7. Predeclare marginal patch contrasts: md benefit = combined/seg-only and md-only/baseline; seg benefit = combined/md-only and seg-only/baseline. A contrast is interpretable only when the candidate patch reports `active` and nonzero relevant hits; otherwise classify structurally inapplicable, not equivalent.
8. Record Node/ICU/OS/CPU, host-state diagnostics, corpus hash, widths/chunks, capabilities, preload environment, resolved realpaths, warmup, and all raw samples. Reject disturbed blocks only by predeclared mode-blind host rules.
9. The script owns `--output` and creates `.bench-results/`; ignore only that directory.

### Checkpoint A: Executable premise gate
**Files:** `scripts/evaluate-benchmark.mjs`, `package.json`
**Depends:** Task 3
**Acceptance:** Locked `0.82.1` shows both hot paths, all modes target one pi-tui build, every chunk is byte-identical, expected patches are active with nonzero work, and at least 20 complete valid blocks exist. Replay-delta RSS is reported but NOT gated at this checkpoint (honest retained-cost accounting lands only in Task 4); the +20 MiB paired bound is enforced at Checkpoint B. Performance magnitude is reported, not gated.
**Verify:** `npm run premise -- --pi 0.82.1 --output .bench-results/premise.json`
**Steps:**
1. Make `premise` install/select the fixture, run replay, evaluate machine pass/fail, and return a nonzero exit code on structural/activity/correctness/sample failure; memory is report-only here.
2. If a patch has no work or fails support, narrow the rest of the plan before continuing.

### Task 4: Harden cache bounds and unstyled md-cache theme key
**Files:** `src/stats.js`, `src/seg-cache.js`, `src/md-cache.js`, `tests/seg-cache.test.js`, `tests/md-cache.test.js`, `compatibility.json`
**Depends:** Checkpoint A
**Acceptance:** Cacheable supported-signature unstyled Markdown is byte-identical across hits and theme/capability/width changes; non-matching custom themes fall back without classification calls; supported themes obey the documented deterministic/pure callback contract; both caches have conservative retained-cost accounting and hard per-entry/total limits.
**Verify:** `node --test tests/md-cache.test.js`
**Steps:**
1. Keep non-null `defaultTextStyle` and non-empty `options` on untouched original rendering. Test independent stateful/throwing callbacks for identical output/exceptions/invocation counts.
2. Define a supported-theme signature from the exact own-key set and `Function.prototype.toString()` hashes of the locked core implementation. Non-matching custom themes fall back without invoking render callbacks (reading keys/sources may still trigger proxy traps on pi's globalThis-proxy theme; that boundary is documented). Explicitly document that matching callbacks must be deterministic, side-effect-free, and input-transparent; source signatures are compatibility gates, not security authentication.
3. Build a bounded, length-framed fingerprint from every renderer-consumed supported field: heading, link, linkUrl, code, codeBlock, codeBlockBorder, quote, quoteBorder, hr, listBullet, bold, italic, underline, strikethrough, highlightCode representative probes, and codeBlockIndent. Any throw, repeat mismatch, shape drift, or oversized output falls back; because probing may already affect a contract-violating matching callback, such spoofed/stateful callbacks are explicitly unsupported rather than promised pristine fallback.
4. Add tests where each core theme component changes independently while old probes remain equal; add non-matching custom/mutable themes proving fallback/no analysis invocation; add matching-but-stateful fixtures proving detection/status where possible and documenting the unsupported boundary without a false byte-identity guarantee.
5. Include capabilities and complete implementation identity in the key; use unambiguous framing/hashing.
6. Change md-cache budget accounting to conservative retained key + rendered value size. Change seg-cache accounting to include key/input, result wrapper/array, and conservative per-record overhead. Add hard per-entry/total limits and worst-case high-segment-count tests; `/rcstats` labels estimates honestly.
7. Retain split hazards, fresh-array ownership, per-instance coherence, streaming differential corpus, and fuzz.

### Task 5: Deterministic correctness suite
**Files:** `tests/md-cache.test.js`, `tests/seg-cache.test.js`, `package.json`
**Depends:** Task 4
**Acceptance:** `npm test` contains no wall-clock ratio assertion; deterministic correctness, cache activity, lifecycle, and bounded fuzz remain.
**Verify:** `npm test`
**Steps:**
1. Move existing md >=5x and seg >=10x assertions into benchmark reporting.
2. Keep completion, byte-equality, expected counters, eviction, ownership, and fallback assertions.
3. Keep bounded named seeds in CI and print seed plus complete failing operation sequence.
4. Keep long random/performance campaigns as explicit maintainer commands.

### Checkpoint B: Executable release-feasibility gate
**Files:** `scripts/release-feasibility.mjs`, `package.json`
**Depends:** Tasks 4–5
**Acceptance:** Compatibility matrix, deterministic suite, premise replay, lifecycle truthfulness, byte equality, and +20 MiB paired replay-delta RSS bound all pass with machine-readable evidence.
**Verify:** `npm run release:feasibility -- --output .bench-results/feasibility.json`

### Task 6: Reproducible setup, CI, package validation, and evidence promotion
**Files:** `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `scripts/check-pack.mjs`, `scripts/promote-evidence.mjs`, `.gitignore`, `evidence/README.md`
**Depends:** Checkpoint B
**Acceptance:** Clean clones install deterministically; CI exercises exact fixtures; tarball has an exact validated manifest; sanitized release evidence has durable custody.
**Verify:** `npm ci && npm run verify && npm run check-pack`
**Steps:**
1. Set `engines.node` to `>=22.19.0`; pin the default dev fixture and install all matrix fixtures from checked-in exact transitive lockfiles.
2. Resolve whether direct pi-tui peer/dev entries are necessary; remove wildcard contract if runtime/types can resolve solely through selected pi, otherwise pin matching versions per fixture and attest type/runtime coherence.
3. Add CI for Node 22.19+ and exact pi `0.80.7`/`0.82.1`; no global pi.
4. `verify` runs tests, typecheck, compatibility matrix, and pack check. `prepublishOnly` invokes the same canonical gate. Heavy 20-block performance remains release-only, not generic CI.
5. Parse `npm pack --json --dry-run` against an exact manifest including mandatory `package.json` and intentional `extensions/`, `src/`, shipped `scripts/`, `fixtures/`, `compatibility.json`, `README.md`, `LICENSE`, and `docs/UPSTREAM_STATUS.md`.
6. Include exactly `assets/screenshot.png` in package/check-pack, or switch README to an immutable absolute image URL and exclude assets; choose and test one path.
7. Keep transient output in ignored `.bench-results/`. `promote-evidence` strips host/private paths, verifies corpus/environment/result hashes, and writes tracked `evidence/<release>/summary.json`; raw unsanitized JSON is retained as immutable CI release artifact. Status docs link both commit and artifact URL.
8. Ignore `.pi-subagents/` for workspace hygiene; package allowlist remains authoritative.

### Task 7: Controlled release validation and documentation
**Files:** `README.md`, `docs/UPSTREAM_STATUS.md`, `package.json`, `package-lock.json`, `evidence/<release>/summary.json`, optionally `assets/screenshot.png`
**Depends:** Task 6
**Acceptance:** Claims have durable sanitized/immutable evidence; live checks are clearly ecological; users know compatibility states, thinking limitation, and independent retirement outcomes.
**Verify:** `npm run release:verify -- --output .bench-results/release.json`
**Steps:**
1. `release:verify` runs exact compatibility fixtures, canonical verification, 20-block controlled replay on the declared release platform, evaluator, evidence promotion, and pack check; any failed structural/correctness/activity/memory requirement exits nonzero.
2. Use live ordinary/thinking/500+ sessions only as ecological checks; do not treat model/network wall time as controlled evidence or publish session content.
3. Reconcile README CPU ranges, tests, upstream version, thinking limitation, package description, screenshot, compatibility table, and final patch states.
4. Document #6665, distinguish #6792, and state #7017/#7082 were unmerged/complementary.
5. Advertise only scripts/fixtures actually shipped.
6. Patch-version bump for hardening/docs; minor only for a user-visible capability change.

## Scope notes (deferred P2)

The statistical machinery below is intentionally sized for release/retirement decisions, not day-to-day development. Deferred until actually needed:

- the full retirement statistical campaign runs only when a released upstream version actually removes or claims to remove a hot path — no standing infrastructure obligation before that;
- the second locked fixture (`0.80.7`) may be dropped from generic CI and kept as an on-demand matrix entry if CI cost becomes an issue;
- `release:verify`'s 20-block replay applies to releases that change runtime behavior; docs-only patch bumps need `verify` + pack check only;
- "matching-but-stateful fixture" testing in Task 4 is bounded: one counter-based and one throw-once fixture suffice to document the unsupported boundary.

## Retirement protocol (future released upstream)

Retire each patch independently after correctness parity through one of two explicit routes:

- **Structural no-work route:** the released upstream removes the hot path, reachability/canaries and deterministic replay show the patch has no reachable work or hits, and install state becomes structurally inapplicable. Performance contrasts are marked not applicable; removal is confirmed by soak/live check.
- **Statistical equivalence route:** the patch remains active with nonzero work. Run at least 20 randomized complete blocks per workload and representative supported environment; do not pool environments. If only one platform is tested, retirement is platform-specific and the patch stays elsewhere. Use the two predeclared marginal contrasts per patch from Task 3. For CPU and latency use within-block log ratios and 95% whole-block bootstrap CIs. Equivalence margin is ratio `[0.95, 1.05]` with the no-patch mode as denominator.
- Memory uses paired replay-delta RSS (pre-replay to sampled replay peak, plus retained-end delta), not lifetime maxRSS. Initial practical margin is ±10 MiB, justified and revalidated from conservative retained-cost limits, pilot noise, and the user resource budget before fixing the final sample count.
- Outcomes are `equivalent`, `not equivalent`, or `inconclusive`; failure to fit inside margins is never called a meaningful difference. No optional stopping after sample count is fixed.
- All workload/metric/environment intervals must pass (intersection rule); no multiplicity correction is needed for falsely declaring the whole intersection equivalent, though inconclusive outcomes become more likely.
- Confirm with soak/live ecological check before removal.

## Verification

- [ ] No hard-coded developer path
- [ ] Exact pi/pi-tui/Node compatibility table and isolated matrix pass
- [ ] Independent patch states and ownership-loss tests pass without layering
- [ ] `npm test` has no timing ratios
- [ ] Replay uses complete randomized process blocks and whole-block inference
- [ ] Every intermediate output is byte-identical
- [ ] Styled and non-matching custom themes remain pristine fallback with zero classification calls; matching theme callbacks are covered by the documented pure/deterministic support contract
- [ ] Complete supported-theme key has mutation/collision regressions and both caches pass worst-case retained-cost limits
- [ ] RSS evidence uses replay deltas, not lifetime maxRSS
- [ ] Checkpoints A/B and release gate are executable with nonzero failure codes
- [ ] Exact tarball manifest includes all advertised scripts/docs/image choice
- [ ] Durable evidence links and hashes exist
- [ ] Retirement is independent, paired, environment-scoped, and three-outcome

## Non-goals

- No message-update throttling, viewport patch, or AssistantMessageComponent monkey-patch.
- No arbitrary callback purity detection or styled-thinking md-cache claim.
- No generic-CI speed threshold.
- No claim that PR #7017/#7082 was released.
- No use of #6792 as core-performance evidence.
