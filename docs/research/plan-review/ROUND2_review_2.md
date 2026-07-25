## Review

- **High — Strategic: the supported compatibility contract and CI matrix are still not precise enough to implement reproducibly.** The resolver has one `PI_PACKAGE_ROOT` input (`/tmp/pi-render-cache-plan-round2-clean.md:53`), while release work merely says to “declare” a pi range and test its lowest/current versions (`/tmp/pi-render-cache-plan-round2-clean.md:126-128`). The current metadata permits arbitrary, independently selected pi and pi-tui versions in both peer and dev dependencies (`package.json:35-41`), but the plan requires one physical pi-tui selected through pi and later allowlists particular `Markdown.render` implementations (`/tmp/pi-render-cache-plan-round2-clean.md:50,99`). A pi range alone therefore cannot state which pi/pi-tui pair is supported or whether each patch is active. **Necessary fix:** before Task 1, define an exact compatibility table (pi version/range, corresponding pi-tui version or identity, Node versions, expected `md-cache` and `seg-cache` states), decide whether the direct pi-tui peer remains necessary, and specify a checked-in matrix setup command that installs each exact pair into an isolated root and passes that root to the resolver. The lockfile can pin the default fixture, but cannot by itself materialize both lowest/current matrix entries.

- **High — Strategic: the two checkpoints and final release gate are acceptance prose, not executable attestations.** Checkpoint A requires locked `0.82.1`, same-module targeting, per-chunk byte equality, and evidence that each cache contributes, but has no verification command or machine pass/fail definition (`/tmp/pi-render-cache-plan-round2-clean.md:74-76`). Checkpoint B likewise has no command and says only “no correctness/memory regression” without a bound or evaluator (`/tmp/pi-render-cache-plan-round2-clean.md:116-118`). Task 7 ends with `npm run verify` “plus the documented release benchmark protocol,” which is not an exact executable command (`/tmp/pi-render-cache-plan-round2-clean.md:134-144`). Task 2’s JSON-producing command alone cannot attest those conclusions (`/tmp/pi-render-cache-plan-round2-clean.md:63-70`). **Necessary fix:** add checked-in evaluator commands for Checkpoints A/B and release (for example `premise`, `benchmark:evaluate`, and `release:verify`) with exact fixture/version inputs, minimum sample counts, paired estimands, bootstrap method/seed, output-equality failure behavior, memory-regression bounds, and exit codes. Define “contributes” mechanically (at minimum observed work/hits; any performance decision needs a predeclared effect rule). Make `verify` or a distinct canonical release command invoke these gates as appropriate.

- **High — Strategic: release evidence has no coherent retention/publication destination.** Task 2 requires all generated benchmark output to live only in ignored `.bench-results/` (`/tmp/pi-render-cache-plan-round2-clean.md:64,72`), while Task 7 requires archived raw JSON to back published claims (`/tmp/pi-render-cache-plan-round2-clean.md:136,139`). Task 6’s proposed package manifest names scripts, fixtures, and linked status documentation, but no evidence location (`/tmp/pi-render-cache-plan-round2-clean.md:130`); current claims are prominent in `README.md:7,57-60`. An ignored local file is neither durable nor independently retrievable. **Necessary fix:** select the archive now—tracked sanitized evidence, an immutable release/CI artifact, or both—and require `docs/UPSTREAM_STATUS.md`/README to record its immutable URL or commit plus corpus/environment/result hashes. State whether evidence ships in the npm tarball; update the exact pack allowlist accordingly. Keep transient runs in `.bench-results/`, but add an explicit promotion/sanitization command for release evidence.

- **High — Strategic dependency/order: Task 3 depends on lifecycle/compatibility infrastructure that is scheduled in Task 4.** Task 3 requires the extension to supply reliable host theme identity/generation and to disable md-cache per supported version when unavailable (`/tmp/pi-render-cache-plan-round2-clean.md:86-87`). The per-patch `unsupported` state, fresh-process allowlist, reasons, and independent lifecycle are not introduced until Task 4, which currently depends on Task 3 (`/tmp/pi-render-cache-plan-round2-clean.md:93-103`). Implementing Task 3 as ordered will either invent temporary disable/state plumbing or force a controller refactor in Task 4. **Necessary fix:** split out and complete the per-patch state/controller contract, compatibility result type, and theme-generation provider before md-cache hardening; then make Task 3 consume it and leave Task 4 for ownership/reload integration tests. Alternatively reorder the lifecycle foundation ahead of Task 3.

- **High — Mechanical: the benchmark verification command fails in a clean clone before the script starts.** Shell redirection opens `.bench-results/latest.json` before `npm run benchmark` executes (`/tmp/pi-render-cache-plan-round2-clean.md:64,109`), but the current `.gitignore` has no such tracked directory or placeholder (`.gitignore:1-3`), and the plan requires the entire directory to be ignored (`/tmp/pi-render-cache-plan-round2-clean.md:72,131`). **Necessary fix:** use a script-owned `--output .bench-results/latest.json` that creates its parent, or prepend `mkdir -p .bench-results &&`; use the corrected command consistently in Task 2, Task 5, and release docs.

- **High — Mechanical shipping coherence: the README screenshot will remain absent from the package unless the plan makes an explicit choice.** README embeds a relative `assets/screenshot.png` (`README.md:12`), the current package allowlist omits `assets` (`package.json:20-25`), Task 6’s future exact manifest also omits it (`/tmp/pi-render-cache-plan-round2-clean.md:130`), and Task 7 lists assets only as optional (`/tmp/pi-render-cache-plan-round2-clean.md:134`). The packed README can therefore contain a broken image even after `check-pack` passes. **Necessary fix:** either include exactly `assets/screenshot.png` in `files` and `check-pack`, or change the README image to an immutable absolute URL and remove `assets` from release scope. Make this a Task 6 pack-acceptance assertion rather than an optional Task 7 cleanup.

## Verdict

**Not ready for implementation convergence until the four strategic/high items are resolved.** The technical direction is strong, but release attestation, compatibility scope, evidence custody, and lifecycle ordering remain underspecified.

**Maturity: 7/10.**

**Strategic vs mechanical:** four strategic corrections (compatibility contract, executable gates, durable evidence, lifecycle ordering) and two mechanical corrections (clean-clone benchmark output creation, screenshot/package coherence).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Six concrete high-severity findings cite /tmp/pi-render-cache-plan-round2-clean.md, package.json, README.md, and .gitignore with necessary fixes."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/ROUND2_review_2.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Restricted review completed using only the revised clean plan plus package.json, README.md, and .gitignore as requested.",
    "No project or plan files were edited."
  ],
  "residualRisks": [
    "Implementation feasibility beyond the allowed manifest/docs surface was not inspected by explicit task scope.",
    "Prior review/provenance material was intentionally not read, so novelty is assessed from this first review of the revised clean plan rather than by comparison with earlier reviews."
  ],
  "noStagedFiles": false,
  "diffSummary": "Added only the requested Round 2 conformance review artifact; no project, plan, implementation, or test files changed.",
  "reviewFindings": [
    "high: /tmp/pi-render-cache-plan-round2-clean.md:53,126-128 and package.json:35-41 - exact pi/pi-tui/Node compatibility pairs and reproducible matrix provisioning are unspecified.",
    "high: /tmp/pi-render-cache-plan-round2-clean.md:74-76,116-118,134-144 - checkpoints and final release protocol lack executable evaluators and pass/fail rules.",
    "high: /tmp/pi-render-cache-plan-round2-clean.md:64,72,130,136,139 - ignored transient benchmark output conflicts with the requirement for durable claim-backing evidence.",
    "high: /tmp/pi-render-cache-plan-round2-clean.md:86-87,93-103 - Task 3 consumes per-version lifecycle/theme-generation infrastructure scheduled only in dependent Task 4.",
    "high: /tmp/pi-render-cache-plan-round2-clean.md:64,109 and .gitignore:1-3 - clean-clone shell redirection fails because .bench-results does not exist.",
    "high: README.md:12, package.json:20-25, and /tmp/pi-render-cache-plan-round2-clean.md:130,134 - relative screenshot is outside both current and planned package allowlists."
  ],
  "manualNotes": "noStagedFiles is false because repository staging state was not inspected under the explicit four-file read restriction; it does not assert that staged changes exist."
}
```
