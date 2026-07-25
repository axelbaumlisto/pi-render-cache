## Review

- **Correct:** The revised plan is materially converged. It correctly keeps styled/default-text-style rendering on the pristine path (`/tmp/pi-render-cache-plan-round2-clean.md:22-31,84-87`), separates the two patch lifecycles and preserves ownership-lost bookkeeping (`/tmp/pi-render-cache-plan-round2-clean.md:92-103`), removes timing ratios from correctness CI (`/tmp/pi-render-cache-plan-round2-clean.md:105-114`), and puts compatibility, benchmark premise validation, correctness/lifecycle hardening, and packaging in a safe dependency order (`/tmp/pi-render-cache-plan-round2-clean.md:48-137`).

- **High — strategic:** The proposed theme token is still unsafe for a passed theme object whose behavior can change without its identity changing. The current cache renders scratch instances with `this.theme` (`src/md-cache.js:107-121`), and the revised key proposes “passed theme object identity plus” the host pi theme identity/generation (`/tmp/pi-render-cache-plan-round2-clean.md:84-88`). Host generation invalidates pi’s proxy, but it cannot invalidate a custom/mutable theme object that closes over state or has methods/properties replaced in place. Object identity would remain stable and stale prefix ANSI could be served. The callback-side-effect tests requested at lines 81-84 do not by themselves define which theme objects are eligible for caching. **Required correction:** explicitly allow caching only when the passed theme is the trusted host Markdown-theme proxy/object associated with the supplied host generation token; otherwise fall back without classification calls. If supported pi exposes other mutable theme objects, require a trusted monotonic generation provider for each one. Add an in-place-mutated custom theme regression test proving fallback/no stale output and no analysis-time callback invocations.

- **High — strategic:** The benchmark/retirement protocol is not yet decision-complete. The four modes are defined (`/tmp/pi-render-cache-plan-round2-clean.md:60-70`), but independent retirement does not state the paired contrasts: md must be evaluated as `combined − seg-only` (and preferably `md-only − baseline`), while seg must be `combined − md-only` (and `seg-only − baseline`). Without this, an unsupported/fail-closed patch can produce identical modes and falsely satisfy “equivalence.” In addition, the plan puts startup/warmup outside timing while recording peak RSS (`/tmp/pi-render-cache-plan-round2-clean.md:68-70`) and later uses a ±10 MiB peak-RSS equivalence margin (`/tmp/pi-render-cache-plan-round2-clean.md:139-144`). Process lifetime `maxRSS` cannot be reset after warmup, so it is not a timed-region peak and can be dominated by startup/warmup. **Required correction:** predeclare per-patch paired mode contrasts, require the candidate patch to be active with nonzero relevant work/hits when interpreting marginal benefit (or classify it explicitly as structurally inapplicable rather than statistically equivalent), define the paired statistic/denominator and multiplicity policy across workloads, and measure RSS with timed-interval sampling or separate controlled memory workers instead of post-warmup lifetime high-water marks.

- **Medium — strategic:** Package/CI dependency coherence remains underspecified. The current manifest independently declares wildcard peers and dev dependencies for both pi and pi-tui (`package.json:35-42`), even though the extension expects its bare pi-tui import to resolve to pi’s own physical copy (`extensions/index.ts:7-8`) and Task 1 requires all tested code to target that selected copy (`/tmp/pi-render-cache-plan-round2-clean.md:48-58`). Task 6 says to pin fixtures and matrix pi versions, but does not say how the direct pi-tui wildcard used by TypeScript/module resolution is kept in lockstep (`/tmp/pi-render-cache-plan-round2-clean.md:120-130`). A matrix job can therefore benchmark pi’s nested pi-tui while typechecking against an independently resolved latest pi-tui; the wildcard peer can also cause consumers to install an unrelated top-level version. **Required correction:** make the selected pi installation the single compatibility unit, or explicitly map and pin the matching pi-tui version in every matrix job. Extend the realpath/version coherence check to the module/type declarations used by typecheck. Decide explicitly whether the pi-tui peer is required by the package host; if runtime aliasing makes it unnecessary, remove it rather than publishing a wildcard contract.

- **Note — residual risk:** The compatibility allowlist and ownership lifecycle are otherwise implementable, but release acceptance should require allowlist entries to bind an exact render implementation fingerprint to the reported pi and physical pi-tui versions/realpaths. Behavioral canaries remain supplemental, as the plan already states (`/tmp/pi-render-cache-plan-round2-clean.md:53-58,98-103`).

**Verdict: CONDITIONAL** — proceed after the three corrections above are incorporated.  
**Maturity: 7.5/10.**  
**Finding class: strategic (not mechanical).**

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Three concrete strategic findings include severity, exact plan/source/package paths and line ranges, impact, and required correction."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/ROUND2_review_1.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read allowed plan, package.json, src/*.js, extensions/index.ts, tests/*.js",
      "result": "passed",
      "summary": "Inspected only the user-authorized review surface."
    },
    {
      "command": "nl -ba on allowed plan and selected allowed implementation/test files",
      "result": "passed",
      "summary": "Collected exact line-number evidence for findings."
    }
  ],
  "validationOutput": [
    "Review identifies unsafe mutable-theme identity handling, incomplete per-patch retirement/RSS methodology, and unresolved pi/pi-tui package-matrix coherence.",
    "No source, plan, package, or test file was edited."
  ],
  "residualRisks": [
    "Mutable non-host theme objects can retain stale cached ANSI unless explicitly excluded or supplied a trusted generation token.",
    "Retirement equivalence can be tautological for an unsupported/no-op patch unless paired mode contrasts and activity requirements are predefined.",
    "Lifetime maxRSS after warmup does not isolate measured-workload peak memory.",
    "Wildcard direct pi-tui resolution can diverge from the selected pi installation used by runtime tests and benchmarks."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested round-2 plan review artifact; no implementation changes.",
  "reviewFindings": [
    "high: /tmp/pi-render-cache-plan-round2-clean.md:84-88 - object identity plus host generation does not invalidate mutable custom theme behavior.",
    "high: /tmp/pi-render-cache-plan-round2-clean.md:60-70,139-144 - retirement lacks explicit per-patch paired contrasts and uses process-lifetime peak RSS despite excluding warmup from timing.",
    "medium: package.json:35-42 and /tmp/pi-render-cache-plan-round2-clean.md:120-130 - independent wildcard pi-tui dependency/type resolution is not coherently tied to each selected pi matrix version."
  ],
  "manualNotes": "CONDITIONAL, maturity 7.5/10; all findings are strategic rather than mechanical."
}
```
