# ROUND 4 — Review 2: Pragmatic Scope Critique

Reviewer role: scope critic, first contact with this artifact.
Inputs read: `/tmp/pi-render-cache-plan-round4-clean.md`, `package.json`, `README.md`. Nothing else (no prior reviews, no docs/PLAN.md, no git history), per instructions.

Framing: this is a ~1.0.3 MIT npm extension, one maintainer, two monkey-patches, 64 tests, and a README that already makes strong public claims ("measured, not guessed", byte-for-byte equality, specific CPU numbers). The right question is not "is the plan rigorous" — it is very rigorous — but "is the rigor proportional to a solo stop-gap extension whose own README says the real fix belongs upstream."

---

## 1. Overall assessment: yes, materially overengineered

The plan reads like a clinical-trial protocol grafted onto a weekend-scale package. The safety reasoning (Safety decisions 1–4) is genuinely good and should be kept. The *machinery* built to enforce it is 2–3× heavier than the package's purpose, audience, or risk profile justifies.

Concrete signal of disproportion: the measured effects the plan itself reports are **30–40× (821–1031 ms → 22–25 ms)** and **2–3×** in the worst case. Effects that large do not need 10,000-replicate fixed-seed percentile bootstraps, within-block log-ratio contrasts, predeclared marginal contrast matrices, and mode-blind host-state rejection rules (Task 3 steps 5–8) to be honestly reported. A median over N fresh-process runs with raw samples archived would support every claim the README makes, with one order of magnitude less evaluator code to write, test, and maintain.

Estimated cost of the plan as written: several weeks of solo effort, most of it in Tasks 3–4 and the evidence pipeline. Estimated cost of the essential core: roughly one week.

---

## 2. Essential vs deferrable

### Essential (correctness / honesty of published claims — keep)

| Item | Where | Why essential |
|---|---|---|
| Remove hard-coded `/Users/shamash/...` paths | Task 1, steps 1–2 | Tests are advertised; they must run for anyone else. This is the single most important fix. |
| Remove wall-clock ratio assertions from `npm test` | Task 5 | Flaky CI = false "64 tests pass" claim on other machines. Cheap, high value. |
| Per-patch independent lifecycle state; no all-or-nothing self-disable; no wrapper layering on reload | Task 2 | README promises "never silently wrong" and idempotent reload. Current all-or-nothing behavior contradicts the safety story. Moderate cost, real correctness. |
| Fix `engines.node` | Task 6 step 1 | `package.json:29` says `>=18.0.0`; the plan's compat table says `>=22.19`. One of these is a false published claim today. Must reconcile (verify what pi itself requires before bumping). |
| Pack manifest / image check | Task 6 steps 5–6 | `package.json` `files` excludes `assets/`, but `README.md` embeds `assets/screenshot.png` relatively → broken image on npmjs.com. Real, user-visible, trivially fixed (absolute URL, as `pi.image` already does). |
| README claim reconciliation (versions, thinking limitation, issue numbers, unmerged PRs #7017/#7082, distinguish #6792) | Task 7 steps 3–5 | Honesty of published claims. Cheap: it is documentation. |
| Keep existing byte-equality corpus + fuzz + fallback-on-doubt | Tasks 4–5 (retention parts) | This is the package's actual correctness guarantee. Already exists; keep. |
| Resolve peer-dependency wildcard question | Task 1/6 | `peerDependencies: "*"` for pi-tui while claiming a single compatibility unit is a contract mismatch. |

### Deferrable or cuttable (does not compromise correctness or honesty)

| Item | Where | Recommendation |
|---|---|---|
| **Retirement protocol** (equivalence margins [0.95,1.05], ±10 MiB, intersection rule, three-outcome classification, per-environment 20-block campaigns) | Retirement section | **Defer entirely.** The plan's own Context says no upstream fix merged (#7017, #7082 both closed unmerged). This is a full statistical protocol for a future event that has not happened. When upstream ships a fix, the structural no-work route (patch reports zero hits) will almost certainly suffice; design the statistical route then, if ever needed. Zero honesty cost: nothing about retirement is published today. |
| **Bootstrap inference engine** (10k-replicate whole-block bootstrap, log-ratio contrasts, predeclared marginal contrast pairs, mode-blind block rejection rules) | Task 3 steps 6–8; `evaluate-benchmark.mjs` | **Cut to**: fresh child processes per mode, fixed corpus, byte-equality check, patch-activity check, N≥10 runs, report min/median/p95 raw. Archive raw samples. With 30× effects this is fully honest. Keep the blocked/paired *design* (cheap); drop the inferential *machinery* (expensive). |
| **Theme output-probing fingerprint** (bounded length-framed probes of 16 renderer-consumed fields, matching-but-stateful spoof fixtures, oversized-output fallback) | Task 4 steps 3–4 | **Simplify.** The allowlist already gates on exact own-key set + `Function.prototype.toString()` hashes of the locked core implementation (Task 4 step 2). If the signature matches the locked core byte-for-byte, the *outputs are determined by the sources you already hashed* — runtime probing adds a second, weaker check plus a new hazard the plan itself worries about (probing may invoke a contract-violating callback). Signature-match ⇒ constant fingerprint per locked implementation; non-match ⇒ fallback, zero calls. This deletes an entire test surface (independent per-field mutation probes, spoof fixtures) with no loss: spoofed sources are already declared unsupported. |
| **Evidence custody pipeline** (`promote-evidence.mjs`, sanitized `evidence/<release>/summary.json`, immutable CI artifact links, hash-verified custody) | Task 6 step 7 | **Cut to**: commit one sanitized benchmark JSON per release under `evidence/`, link it from README. "Durable custody" ceremony is enterprise-audit posture for a hobby-scale MIT package. Honesty needs the numbers and the script that produced them, not a chain of custody. |
| **Dual locked compat fixtures with integrity/realpath/ICU attestation** | Task 1 steps 4–6, both `fixtures/compat/*/package-lock.json` | **Halve.** Keep one pinned fixture (latest supported, 0.82.1) in CI + the existing runtime hash-mismatch install guard (README "Version-drift guard") as the safety net for everything else. 0.80.7 coverage can be a manual pre-release check. Full realpath/hash/type-resolution attestation on every run is gold-plating. |
| **20-block minimum for release evidence** | Task 3 step 5, Checkpoint A, Task 7 step 1 | Reduce to ~10 runs, or keep 20 only for the mode contrasts actually published in README. See §3. |
| **Memory equivalence machinery** (paired replay-delta RSS, ±10/±20 MiB margins) | Checkpoint A, Task 4 step 6, retirement | Keep the cheap parts: hard cache size limits + a single "RSS delta under replay ≤ X MiB" smoke assertion. Drop paired-margin statistics. |
| `--json` modes, JSON-only outputs, stderr/human split | Task 1 step 7, Task 3 | Nice-to-have; do last or drop. |

---

## 3. Acceptance criteria that make delivery unrealistically expensive

1. **Checkpoint A: "at least 20 complete valid blocks" with predeclared mode-blind rejection rules.** The runs themselves are cheap; *writing and validating the evaluator* (block validity, disturbance rules, bootstrap, structural-inapplicability classification) is the expensive part, and it gates everything downstream (Tasks 4–7 all depend on it). This puts the most speculative engineering on the critical path of the most essential fixes. **Restructure: Tasks 4/5 (cache hardening, deterministic suite) do not actually need Checkpoint A's statistics — only its byte-equality and activity checks. Decouple them.**
2. **Task 4: "matching-but-stateful fixtures proving detection/status where possible."** "Where possible" is unbounded — detecting statefulness is exactly the halting-problem-adjacent thing Safety decision 1 correctly refuses to do for styled callbacks. As written this invites open-ended fixture archaeology. If the probing step is cut per §2, this criterion disappears.
3. **Retirement: "per workload and representative supported environment; do not pool environments."** For a solo maintainer this means N machines × workloads × 20 blocks before removing a patch. The platform-specific escape hatch mitigates it, but the honest framing is: this protocol will never be executed as specified. Defer.
4. **Task 6/7: `release:verify` requires the full 20-block controlled replay on the declared release platform for every release**, while Task 7 step 6 says docs/hardening releases are patch bumps. A README typo fix should not require a controlled benchmark campaign. Scope the perf gate to releases that change `src/` or published performance claims.
5. **Verification checklist: "Every intermediate output is byte-identical."** Fine as a corpus assertion (already exists); unrealistic if read as a universal quantifier over all replay chunks in all modes forever. Keep it scoped to the checked-in corpora.

---

## 4. What the plan gets right (do not cut)

- **Safety decision 1** (no styled-callback purity probing) — correct and correctly bounded.
- **Safety decision 3** (one compatibility unit) — right call; simplifies everything.
- Moving timing assertions out of `npm test` (Task 5) — exactly right.
- Fresh-child-process, paired-design benchmarking *as a design principle* — keep the design, cut the inference.
- Non-goals section — good discipline; notably it already refuses generic-CI speed thresholds.
- Explicit "not authentication, compatibility gating" framing for theme signatures — honest.

---

## 5. Recommended minimal plan (cut list applied)

1. Task 1 (trimmed): portable resolver, kill absolute paths, one pinned CI fixture, `compatibility.json`. 
2. Task 2 as written (this is the real product hardening).
3. Task 3 (trimmed): deterministic replay + fresh-process runner + byte-equality + activity + raw medians. No bootstrap evaluator.
4. Task 4 (trimmed): retained-cost accounting, hard limits, signature-only theme gate, keep corpus/fuzz.
5. Task 5 as written.
6. Task 6 (trimmed): engines fix, CI, pack check, image fix, commit sanitized bench JSON.
7. Task 7 (trimmed): README reconciliation, upstream status doc.
8. Retirement protocol: delete from this plan; one paragraph pointing to the structural no-work route suffices.

This preserves every published claim's truthfulness, all correctness guarantees, and the safety boundaries — and cuts roughly half the engineering.

---

## Verdict

- **Verdict: CONDITIONAL GO** — the essential fixes (Tasks 1, 2, 5, 6-lite, 7-lite) are necessary and well-specified; condition is descoping Task 3's inference engine, Task 4's output-probing layer, the evidence-custody pipeline, and deferring the retirement protocol. As written end-to-end, the plan risks stalling the important fixes behind speculative statistical infrastructure.
- **Maturity: 6/10** — high analytical rigor and honest safety boundaries, but poor proportionality: effort allocation is inverted relative to user-facing risk (most engineering goes to proving 30× effects with confidence intervals; the actual product bugs — paths, lifecycle, engines, broken npm image — are a minority of the plan).
- **Strategic vs mechanical: strategic in its safety decisions and compatibility contract; mechanical (procedure-maximizing) in its measurement and evidence machinery.** The plan optimizes for audit-proofness rather than for shipping a correct, honest 1.0.4.
