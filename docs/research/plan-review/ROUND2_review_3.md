# Round 2 performance-methodology review

**Scope:** Reviewed only `/tmp/pi-render-cache-plan-round2-clean.md`, specifically Task 2 and Task 7 step 6. No repository reviews, `docs/PLAN.md`, `.pi-subagents` contents, or git history were read.

## Substantive findings

1. **High — `/tmp/pi-render-cache-plan-round2-clean.md`, Task 2 steps 3–5 and Task 7 step 6: “paired” is not operationally defined, so the proposed confidence intervals need not be paired intervals.**

   “Multiple fresh workers in interleaved mode order” and retaining `mode order` are not enough. The plan must define the independent experimental unit and pairing/blocking key: one block should contain all compared modes for one workload under the same controlled host state; mode order within each block should be randomized or counterbalanced; retirement contrasts must be computed *within blocks*. Bootstrap resampling must resample whole blocks, not individual mode observations or chunk latencies. Chunk renders are repeated observations inside a run, not independent replicates. Otherwise host drift/order effects or pseudoreplication can make a retirement CI spuriously narrow. NIST describes blocking as the way to account for nuisance factors and requires randomized treatment order within blocks. [NIST, Randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm)

   **Required plan correction:** Predeclare block construction, counterbalancing/randomization seed, the paired contrast, and cluster/block bootstrap. Also state that “fresh workers” means isolated child processes; if it means Node worker threads, process CPU and RSS are shared-process measures and cannot support mode-level paired decisions.

2. **High — `/tmp/pi-render-cache-plan-round2-clean.md`, Task 2 step 5 and Task 7 step 6: the equivalence estimand, CI construction, replicate count/power, and stopping rule are unspecified.**

   “95% confidence intervals wholly inside” margins is directionally valid and conservative, but a decision is not reproducible until the plan says exactly what interval is calculated. It must specify, per patch/workload/metric: which two modes are compared for retirement (for example, pristine released upstream versus that patch active, with the other patch held identically); whether percent margins apply to the paired ratio/geometric mean ratio or a normalized paired difference; which side is the denominator; and the bootstrap interval algorithm. Independently comparing medians or overlapping marginal CIs is not an equivalence test. The number of blocks cannot be left as “multiple”: it needs an a-priori precision/power target, minimum replicate count, and a no-optional-stopping rule (or a predeclared sequential design). FDA’s authoritative equivalence guidance illustrates the core principle that equivalence is assessed against pre-specified limits using a confidence interval on the treatment comparison, commonly on a log scale for ratio endpoints. [FDA, Statistical Approaches to Establishing Bioequivalence](https://www.fda.gov/media/163638/download)

   **Required plan correction:** Define the estimand and interval formula, resampling unit, fixed sample size justified from pilot variance (or a valid sequential rule), and outcome categories: equivalent / not equivalent / inconclusive. Do not interpret failure to fit inside the margins as evidence of a meaningful difference.

3. **High — `/tmp/pi-render-cache-plan-round2-clean.md`, Task 2 steps 3–4 and Task 7 step 6: peak RSS as currently described does not measure cache memory equivalence.**

   Warmup and startup are said to be outside the *timed* region, but `process.resourceUsage().maxRSS` is a lifetime high-water mark. It can therefore be set during startup/warmup and never reflect the replay or retained cache cost; fresh-process variation can also dominate a 10 MiB boundary. Node documents `maxRSS` as the maximum resident set size for the current process, while `process.memoryUsage().rss()` is an instantaneous whole-process value. [Node.js process resource usage](https://nodejs.org/api/process.html#processresourceusage) [Node.js memory usage](https://nodejs.org/api/process.html#processmemoryusage)

   **Required plan correction:** Define memory as a replay-attributable paired measure—at minimum sample RSS after standardized warmup/GC policy and through replay, report pre-replay RSS, peak sampled RSS, end/retained RSS, and compare deltas from the pre-replay value. Keep OS high-water RSS only as supplementary evidence. Justify the 10 MiB practical margin from an explicit user/resource budget; otherwise that absolute threshold is arbitrary and can be simultaneously too permissive for ordinary sessions and too strict/noisy across runtimes.

4. **Medium — `/tmp/pi-render-cache-plan-round2-clean.md`, Task 2 step 1 and Task 7 steps 1 and 6: render latency is not defined tightly enough to prevent cadence dilution or aggregation bias.**

   The fixture contains fixed cadence, but the retirement endpoint is “render latency.” If scheduled waiting is included, cadence can swamp implementation cost and make two implementations appear equivalent. If per-chunk timings are pooled, long workloads contribute many correlated pseudo-samples. A median run total also answers a different question from tail frame latency, which is often the practical interactive concern.

   **Required plan correction:** Define latency boundaries around synchronous render/update work only; preserve cadence solely as workload ordering unless lateness/backlog is a separately named endpoint. Predeclare run-level summaries (for example total render CPU/wall work plus within-run p95 update latency), then perform inference across paired process blocks. Specify clock, timer overhead handling, and whether GC pauses are intentionally included.

5. **Medium — `/tmp/pi-render-cache-plan-round2-clean.md`, Task 7 steps 1 and 6: a retirement decision on one release platform is not scoped to the supported environment matrix.**

   The plan records Node/ICU/OS/CPU and CI covers a Node/pi matrix, yet controlled release replay is singular (“the release platform”). Unicode segmentation, JIT behavior, scheduling, and memory accounting can vary materially by Node/ICU/OS/architecture. A global patch retirement based only on Apple M3 evidence would overgeneralize.

   **Required plan correction:** Either declare retirement platform-specific and retain the patch elsewhere, or require equivalence on a predeclared representative matrix covering supported Node/ICU and architectures. Margins may remain common, but each environment must meet them independently; pooled cross-platform samples are not interchangeable replicates.

## What is adequate

- Interleaving, fresh isolation, raw samples, environment/corpus hashes, exclusion of startup from latency timing, byte-identical output, and refusal to use best-of-N are sound foundations.
- Independent retirement by patch and testing ordinary, thinking, and long-transcript workloads are scientifically appropriate.
- Requiring an interval wholly within a predeclared practical margin is the correct equivalence principle. A 95% interval is stricter than the 90% interval commonly paired with two one-sided 5% tests, not intrinsically invalid. The invalidating gap is the missing estimand/design/interval specification, not the chosen 95% confidence level.
- Simultaneously requiring all endpoint/workload intervals to pass is conservative for retirement; no multiplicity adjustment is required to protect against falsely declaring the complete intersection equivalent, though the policy will increase inconclusive outcomes.

## Residual risks after correction

- Fixed replay corpora can miss future transcript/Unicode distributions; retain the ecological soak as a guard, not as inferential evidence.
- CPU/latency equivalence on an idle controlled host does not establish equivalence under thermal throttling or contention; archive host-state diagnostics and reject disturbed blocks using predeclared, mode-blind rules.
- Structural hot-path removal is a defensible additional product criterion, but it is logically separate from empirical equivalence and should be reported separately when it blocks retirement.

## Verdict

**Revise before using the protocol for release or retirement decisions.** The plan has the right overall convergence strategy, but the paired design and equivalence analysis are still underspecified enough to permit invalidly narrow intervals, while lifetime peak RSS does not isolate the memory effect being judged.

**Maturity: 6.5/10.**

**Strategic vs mechanical:** Mostly **strategic/statistical** (experimental unit, estimand, equivalence decision rule, environment scope); the RSS instrumentation and latency boundary fixes are **mechanical** once those choices are specified.