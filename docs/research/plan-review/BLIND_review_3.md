## Review

### Correct
- **Fresh-process mode isolation is the right baseline direction.** `/tmp/pi-render-cache-plan-clean.md:34-43` explicitly separates baseline/seg-only/md-only/both and launches each mode in a fresh subprocess, avoiding the shared `globalThis[Symbol.for(...)]` state used by `src/md-cache.js:23,138-153` and `src/seg-cache.js:8,75-87`.
- **The plan preserves important existing safety contracts.** `/tmp/pi-render-cache-plan-clean.md:69-71,91-94` keeps style in both scratch renderers, keeps `options` on fallback, separates patch health, and retains restore-only-if-owned behavior. Existing output differential, cache ownership, eviction, reload, and foreign-wrapper tests are substantial (`tests/md-cache.test.js:324-395`, `tests/extension.test.js:20-100`).
- **Correctness is generally specified byte-for-byte rather than visually.** `/tmp/pi-render-cache-plan-clean.md:48-57,76-82,132-143` asks for every streaming intermediate render to match pristine output and includes theme switches, resize, fuzz, and a real PTY run.
- **Observed baseline tests pass in the current local environment.** `node --test tests/md-cache.test.js` passed 16/16 (about 23.3 s); `node --test tests/seg-cache.test.js` passed 6/6 (about 1.0 s). This attests only the current implementation/environment, not the proposed styled callback design.

### Blocker

1. **[BLOCKER] Finite probing cannot establish purity or semantic equivalence of an arbitrary JavaScript callback.**  
   **Locations:** `/tmp/pi-render-cache-plan-clean.md:51-56,65-70`; current fallback at `src/md-cache.js:66-75`.

   The proposed rule accepts a callback after repeated calls on multiple sentinels. Concrete counterexamples:

   - `s => { auditCount++; return red(s); }` returns identical bytes for every repeated probe but probing adds observable calls that pristine rendering never makes.
   - A callback can return the same result for all known probes but branch on real Markdown payload: `s => probeSet.has(s) ? red(s) : blue(s)`. It receives the same fingerprint as the red callback, yet a cached prefix produced under one callback is wrong for the other.
   - `s => { if (first) { first = false; throw new Error("once"); } return red(s); }`: analysis catches the first exception and then falls back; the original render now sees the second call and succeeds, whereas pristine rendering throws. “Catch then call original” does not preserve original behavior.
   - A state machine can agree for any finite probe sequence and diverge on the next call. Random/secret sentinels do not fix this; they only make the counterexample less convenient.

   Repeated probes therefore cannot prove “unsafe/stateful styles fall back,” and probing can itself change the output or exception behavior. The proposed adversarial tests are insufficient if pristine and patched paths share one callback closure or are run sequentially: the baseline mutates callback state before the patched path.

   **Minimal plan correction:**
   - Do not claim arbitrary callbacks can be certified pure. Cache decoration-only styles with no callback, and allow `color` only through an explicit trusted/allowlisted canonical pi thinking callback (or an injected trusted fingerprint/version provider owned by the extension). All other functions fall back without invocation by the analyzer.
   - If canonical identity cannot be obtained robustly, retain the current fallback for every `color` callback; correctness takes priority over the desired md-cache thinking speedup.
   - Rewrite Task 2 tests so pristine and patched branches receive separately constructed callbacks with identical initial state. Assert callback call counts and exception identity/message using side-effect-only, throw-once, probe-aware, and late-diverging callbacks.
   - Treat probe-based classification, if retained at all, as best-effort telemetry rather than a correctness boundary.

2. **[BLOCKER] The style work does not close the existing incomplete theme cache key, so ordinary and styled prefixes can still return stale ANSI.**  
   **Locations:** `src/md-cache.js:32-44,89-100`; `tests/md-cache.test.js:274-298`; `/tmp/pi-render-cache-plan-clean.md:54-55,67-69,137-141`.

   `themeFingerprint()` samples only `heading`, `code`, `listBullet`, `quote`, and `codeBlockIndent`. A theme switch that changes strong/emphasis/link/table/plain-text styling while leaving those five outputs unchanged preserves the key and can reuse stale settled-prefix lines. The existing test changes only `mdHeading` (`tests/md-cache.test.js:283-293`), which is exactly one of the sampled methods, so it cannot expose this collision. Styled callback probing does not repair the unstyled cache key and is also subject to finding 1.

   **Minimal plan correction:**
   - Add a Task 2 prerequisite that enumerates every theme field/function consumed by the supported pi-tui `Markdown.render` and constructs a length-framed fingerprint from all of them; fail closed when the expected theme shape drifts.
   - Add differential cache-hit tests that switch each relevant theme component individually while all current five probes remain unchanged. Test both fresh instances and an invalidated reused instance.
   - Make the compatibility check verify this complete expected theme surface on each supported pi-tui version. A source hash alone is not the gate.

3. **[HIGH] “Disable cleanly” conflicts with restore-only-if-owned when a foreign wrapper closes over this patch.**  
   **Locations:** `src/md-cache.js:138-163`, `src/seg-cache.js:75-97`, `tests/extension.test.js:20-59`; `/tmp/pi-render-cache-plan-clean.md:84-94`.

   Current `uninstall()` leaves a foreign top-level wrapper in place but deletes shared state. In the test’s concrete pattern, the foreign function still calls `ours`, so the cache patch remains active and functional after it is reported uninstalled. A later install sees no state, wraps the foreign function, and creates a chain `new patch -> foreign -> old patch`; this is double patching, not clean disable/reload. Existing tests manually restore the prototype and only assert that state was dropped, so they encode the hazardous half-state rather than exercising the subsequent reload.

   **Minimal plan correction:**
   - Define ownership-loss as a distinct **blocked/unmanaged** state. If the prototype is not owned, do not delete the global state and do not report the patch disabled; installation must not add another layer.
   - Only restore and delete state when ownership is held. If an upstream/foreign replacement has completely displaced the patch, safe removal cannot be inferred from function source; report that restart/manual removal is required rather than claiming success.
   - Add the missing sequence test: install -> foreign wrapper calling ours -> uninstall/health failure -> install/reload -> render. Assert one cache layer, retained bookkeeping, and truthful status. Repeat for Segmenter.

### Note

4. **[HIGH] The plan contradicts itself on noisy performance assertions and leaves two existing timing thresholds in the correctness suite.**  
   **Locations:** `/tmp/pi-render-cache-plan-clean.md:43,73-82`; `tests/md-cache.test.js:398-431`; `tests/seg-cache.test.js:147-172`.

   Task 1 says CI should report ratios without brittle failure, but Task 4 adds a `>=3x` “soft gate”; the current suite already hard-fails at `>=5x` and `>=10x`. `best-of-N` independently minimizes numerator and denominator, is biased by scheduler/GC outliers, and the Markdown timing test consumed about 19.9 s in this run. Adding another styled threshold increases both flakiness and suite latency.

   **Minimal plan correction:** move all ratio assertions out of `node --test tests/` into the reporting benchmark. Keep only correctness, cache-activity, and workload-completion assertions in CI. Report warmups, all samples, median and dispersion (or confidence interval), runtime/CPU/model metadata, and an explicitly non-gating target. Use a documented statistical rule for the retirement gate rather than “statistically meaningful” without sample count or decision rule.

5. **[HIGH] A clean checkout is not currently reproducible because tests resolve one developer’s absolute global installation, and the plan does not explicitly replace that resolver.**  
   **Locations:** `tests/helpers.js:1-12`; `/tmp/pi-render-cache-plan-clean.md:34-43,96-105`.

   Both pi and pi-tui paths are hard-coded under `/Users/shamash/local/...`. A lockfile does not make this global path exist, and a benchmark resolver can silently use a different pi-tui instance from the tests/extension. This directly contradicts Task 1 and Task 6 acceptance.

   **Minimal plan correction:** make replacement of `tests/helpers.js:6-12` an explicit Task 1 deliverable. Use one shared resolver for compatibility checks, benchmark workers, and tests; support an explicit environment override for an upgrade matrix; print package versions plus canonical realpaths; and fail if the extension/test/benchmark resolve different pi-tui instances. Run the clean-checkout test in a temporary directory or CI image with the developer-global path unavailable.

6. **[MEDIUM] Fresh subprocesses prevent cache contamination but do not by themselves make benchmark comparisons fair or isolated.**  
   **Location:** `/tmp/pi-render-cache-plan-clean.md:39-43,79-82`.

   Concrete remaining contamination/drift sources are `NODE_OPTIONS` preloads, inherited extensions, different JIT warmup, thermal/order bias, locale/ICU/terminal capability differences, and accidentally timing process startup. One fresh process per mode can compare one cold/JIT trajectory against another rather than steady-state work.

   **Minimal plan correction:** use a worker protocol that asserts pristine prototype identity before baseline and exact patch ownership for each patched mode, sanitizes or reports preload-affecting environment, warms the identical corpus outside the timed region, emits per-repeat samples, and launches multiple fresh workers in interleaved/randomized mode order. Pin/report Node, ICU, locale, capability bits, corpus hash, widths, chunk schedule, and resolved module realpaths. Keep subprocess startup outside measured time.

7. **[MEDIUM] Style fingerprints can bypass the stated memory budget and need unambiguous framing.**  
   **Locations:** `src/md-cache.js:91-113`; `/tmp/pi-render-cache-plan-clean.md:67-71`.

   Cache accounting charges only `settled.length`, not key length, rendered lines, theme fingerprint, or the proposed style fingerprint. A stable callback can wrap each sentinel with megabytes of text, pass repeat-consistency checks, and create megabyte keys on every render while the cache reports a tiny `chars` value. Concatenating arbitrary callback outputs without length framing also permits structural collisions between multiple sentinel results/adjacent key components.

   **Minimal plan correction:** cap probe result and total fingerprint lengths and fall back when exceeded; encode components with canonical JSON or explicit length prefixes; hash only after unambiguous serialization; include retained key/value size in budget accounting (or rename/document the metric as source-char budget). Add a stable huge-output callback and delimiter/NUL-bearing outputs to tests.

8. **[MEDIUM] Upgrade-drift tests currently prove a predicate is computable, not that the extension performs the correct transition.**  
   **Locations:** `tests/extension.test.js:1-5,61-100`; `/tmp/pi-render-cache-plan-clean.md:84-94`.

   The existing file explicitly says it tests underlying contracts rather than executing the extension. Its alien-render test computes `drifted` locally and asserts `true`; it does not verify notification, per-patch disablement, `/rcstats`, or continued seg-only operation. `Function.prototype.toString()` hashes can also accept behaviorally incompatible replacements with copied source or reject harmless source-format changes.

   **Minimal plan correction:** add an integration-level or dependency-injected extension-controller test that performs the health check and asserts actual prototype/state/status transitions for md-only failure, seg-only failure, both failures, foreign ownership loss, and repeated reload. Compatibility should include behavioral constructor/render/segment probes and exact prototype ownership; source signatures/hashes may be diagnostics, not sole safety gates.

9. **[MEDIUM] Styled differential/fuzz tests need state isolation and reproducible failure artifacts.**  
   **Locations:** `/tmp/pi-render-cache-plan-clean.md:45-57,73-82`; current fuzz structure at `tests/md-cache.test.js:434-480`.

   Stateful callbacks make baseline-first versus patched-second comparisons order-dependent. A single fixed fragment seed can also pass while missing interactions between style mutation, callback state, theme switch, resize, and cache eviction.

   **Minimal plan correction:** instantiate independent style callback/state/theme fixtures for each side; compare thrown outcomes as well as returned lines; run several fixed named seeds with bounded runtime; include style changes, eviction, capability toggles, theme changes and resize in generated operation sequences; and print seed plus minimized/complete failing operation sequence. Keep deterministic fuzz in CI and longer randomized campaigns outside CI.

### Residual risks after minimal corrections
- Supporting a canonical pi callback by identity/provider couples the extension to upstream construction details; compatibility must fail closed when that identity/provider changes.
- JavaScript monkey-patch chains cannot be safely spliced in the general case. Ownership loss may require a restart and must be reported honestly.
- A complete theme fingerprint remains an upgrade-maintenance surface; newly added renderer theme dependencies must disable md-cache until recognized.
- Microbenchmark ratios remain machine- and runtime-specific even with better sampling; real PTY CPU/responsiveness validation remains necessary.

## Verdict

**CONDITIONAL — maturity 6/10.** The staged validation and independent-patch direction are sound, but implementation should not start until Task 3 is narrowed from “prove arbitrary callback purity by probes,” theme fingerprint completeness is added, foreign-wrapper ownership transitions are specified, and timing assertions are removed from correctness CI.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Nine concrete findings are recorded with severity, counterexamples, minimal corrections, and citations to /tmp/pi-render-cache-plan-clean.md plus src/tests paths; a dedicated residual-risks section is included."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/BLIND_review_3.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --test tests/md-cache.test.js",
      "result": "passed",
      "summary": "16/16 tests passed; total about 23.3 s, with the existing Markdown perf gate about 19.9 s."
    },
    {
      "command": "node --test tests/seg-cache.test.js",
      "result": "passed",
      "summary": "6/6 tests passed; total about 1.0 s."
    }
  ],
  "validationOutput": [
    "Reviewed only /tmp/pi-render-cache-plan-clean.md and files under src/ and tests/ as the substantive review scope.",
    "Requested plan.md and progress.md were absent (ENOENT); no docs/research, docs/PLAN.md, git history, .pi-subagents, or other reviews were read.",
    "No source, tests, or plan files were edited."
  ],
  "residualRisks": [
    "Arbitrary JavaScript callback purity cannot be established by finite probing; support must be narrowed to trusted canonical callbacks or callback-free decoration styles.",
    "Theme fingerprint completeness and upstream theme-surface drift remain fail-closed maintenance requirements.",
    "Foreign monkey-patch ownership loss may require restart because wrapper chains cannot be safely spliced.",
    "Performance conclusions remain environment-specific and require statistical reporting plus real PTY validation."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested blind adversarial plan review; no implementation or plan changes.",
  "reviewFindings": [
    "blocker: /tmp/pi-render-cache-plan-clean.md:65-70 - finite sentinel probing cannot prove arbitrary callback purity and can itself alter calls, state, exceptions, and output.",
    "blocker: src/md-cache.js:32-44 - incomplete theme fingerprint permits stale cached ANSI when unsampled theme components change.",
    "high: src/md-cache.js:156-163 and src/seg-cache.js:90-97 - deleting state after ownership loss leaves foreign closures calling an untracked old patch and permits double layering on reinstall.",
    "high: tests/md-cache.test.js:398-431 and tests/seg-cache.test.js:147-172 - brittle hard timing gates contradict the plan's non-gating CI policy.",
    "high: tests/helpers.js:6-12 - absolute developer-global pi paths violate clean-checkout and same-instance reproducibility.",
    "medium: /tmp/pi-render-cache-plan-clean.md:39-43 - fresh subprocesses need warmup, repeated interleaved workers, environment controls, and ownership assertions.",
    "medium: src/md-cache.js:91-113 - arbitrary style fingerprints can be huge/collision-prone while cache accounting ignores key/value size.",
    "medium: tests/extension.test.js:83-100 - drift test asserts a locally computed predicate rather than actual disable/status behavior.",
    "medium: /tmp/pi-render-cache-plan-clean.md:45-82 - stateful callback differential/fuzz tests require independent cloned state and reproducible operation sequences."
  ],
  "manualNotes": "Verdict: CONDITIONAL, maturity 6/10."
}
```
