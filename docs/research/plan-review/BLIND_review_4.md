# Blind delivery/maintenance review

## Findings

1. **Blocker — `/tmp/pi-render-cache-plan-clean.md` Task 1 / Task 6: CI is required but no CI deliverable exists.** Task 1 says structural correctness will be asserted “in CI,” yet none of the eight tasks owns a workflow file, Node-version matrix, clean-checkout job, or artifact check. An npm `verify` script is not CI by itself. Add an explicit workflow deliverable (for example `.github/workflows/ci.yml`) that runs `npm ci`, correctness tests, typecheck, compatibility checks, and an automated tarball allowlist on every supported Node version. Define which benchmark results are informational rather than gating.

2. **High — `package.json` `files` versus `/tmp/pi-render-cache-plan-clean.md` Tasks 1 and 7: the advertised validation tools would not be shipped.** The tarball currently permits only `extensions`, `src`, `README.md`, and `LICENSE`. Planned `scripts/check-upstream.mjs`, `scripts/benchmark.mjs`, and `docs/UPSTREAM_STATUS.md` will therefore be absent from an npm install, while Task 7 proposes telling users to run `npm run compat` and `npm run benchmark`. Those scripts in the shipped `package.json` would point to missing files. Either publish the scripts/status document by extending `files`, or clearly label the commands as source-checkout maintainer commands and avoid exposing unusable package scripts to installed-package users.

3. **High — `/tmp/pi-render-cache-plan-clean.md` Task 6 and Verification: the package-content assertion is not executable as written.** `npm pack --dry-run` reports contents but does not fail merely because an unintended file appears. The checklist also says the tarball contains “only `extensions/`, `src/`, `README.md`, and `LICENSE`,” although npm necessarily includes `package.json`; publishing the new commands would also require `scripts/`. Define the exact allowlist including mandatory npm metadata, parse `npm pack --json --dry-run`, and fail CI on missing or extra files. Reconcile that allowlist with Finding 2.

4. **High — `/tmp/pi-render-cache-plan-clean.md` Tasks 3–8: the real-world go/no-go decision occurs too late.** Task 8 may revert styled Markdown support after Tasks 4–7 have already built gates, compatibility work, documentation, and a minor-version release narrative around it. That creates a rollback cascade and leaves unclear which tests/docs/version bump survive. Move a repeatable styled-stream feasibility gate immediately after Task 4; only then proceed to release hardening and final documentation. Alternatively split the work into two releases: harness/independent-patch hardening first, styled support second.

5. **High — `/tmp/pi-render-cache-plan-clean.md` Tasks 1, 5, 6, and 8: path-independent pi discovery is asserted but not specified end to end.** Resolving a project dev dependency from a benchmark process does not prove it is the exact module instance aliased inside a running pi host. The manual task also says “run ... on pi 0.82.1” without a reproducible local invocation, so it may silently use a globally installed `pi`. Specify package-root discovery via Node resolution, print resolved module paths as well as versions, run the locked local executable (for example through `npm exec --no -- pi`, subject to the actual CLI), and have runtime `/rcstats` report the host-loaded package/version. No script should depend on a repository path, a user home directory, or global pi installation.

6. **High — `package.json` peer/dev dependency policy versus `/tmp/pi-render-cache-plan-clean.md` Tasks 5–7: “supported pi versions” is undefined.** Both pi packages use `"*"` for peers and dev dependencies, while the plan validates one release, `0.82.1`, and speaks broadly about “supported pi versions.” A lockfile makes `npm ci` repeatable but does not define the consumer compatibility claim. Document a tested version/range policy, lock the fixture versions used for release evidence, and add at least a lowest/current supported matrix or explicitly state that untested versions are accepted only under runtime guards. Also verify that `engines.node >=18` is compatible with every chosen pi version.

7. **High — `package.json` scripts and `/tmp/pi-render-cache-plan-clean.md` Task 6: release gating remains weaker than verification.** The current `prepublishOnly` runs `check`, which omits tests. Task 6 adds `verify` but does not explicitly make publishing or CI invoke the same release gate. Define one canonical release command and wire `prepublishOnly` to it (or document a deliberate reason not to), including tests, typecheck, compatibility, and automated pack validation. Update the lockfile’s root package version together with `package.json` when Task 7 changes `1.0.3` to the intended minor version.

8. **High — `/tmp/pi-render-cache-plan-clean.md` Tasks 1 and 4: performance requirements conflict.** Task 1 says performance ratios must not hard-fail on noisy machines; Task 4 calls a 3× target a “soft performance gate,” while its acceptance requires a “meaningful speedup.” “Soft gate” has no release semantics, and best-of-N biases results toward lucky samples. Separate deterministic correctness counters (hard gate) from performance evidence (advisory in generic CI), then define a controlled release benchmark protocol using warmups, multiple subprocess samples, median/dispersion, fixed seed/input, Node/pi versions, CPU/OS metadata, and an explicit maintainer go/no-go threshold.

9. **Medium — `/tmp/pi-render-cache-plan-clean.md` Task 1: machine-readable output is underspecified.** Mixing JSON and a human summary on stdout makes reliable parsing awkward, and “generated benchmark output” has no named path or `.gitignore` pattern. Provide a stable `--json` mode whose stdout is JSON only, send summaries to stderr or a separate mode, name any output directory, and add that exact directory to `.gitignore` without ignoring source fixtures.

10. **Medium — `/tmp/pi-render-cache-plan-clean.md` Task 2: the claimed preimplementation failing test is internally inconsistent.** Byte-identical differential tests should already pass when styled rendering takes the pristine fallback, so they do not demonstrate a failing feature test. Make the red test assert instrumentation/counters (canonical style has cache activity and no style fallback) while keeping byte-equivalence tests green; Task 3 should make only that cache-activity expectation pass.

11. **High — `/tmp/pi-render-cache-plan-clean.md` Task 8: manual CPU validation is not reproducible enough for published claims.** “Identical model/prompt” does not produce identical streamed chunks, and wall time/process CPU delta is confounded by model/network variance. “Peak responsiveness” is subjective. Define the sampling command/tool, interval, warmup, number/order of runs, terminal dimensions, Node/pi/model identifiers, extension isolation, and aggregation. Prefer replaying a captured non-private chunk/timing trace for controlled before/after CPU evidence, with live model runs as a separate ecological check. Record numeric raw summaries and pass/fail criteria in `docs/UPSTREAM_STATUS.md`.

12. **Medium — `README.md` and `/tmp/pi-render-cache-plan-clean.md` Task 7: versioned claims need a release-time consistency checklist.** The README currently contains exact CPU ranges, test counts, upstream version `0.80.7`, and a thinking-block limitation. Task 7 updates several of these but does not explicitly require removing or reconciling every stale number/limitation after a possible Task 8 revert. Add a release checklist that synchronizes the README description, metrics, correctness counts, limitations, upstream status, package description, and final feature decision.

13. **Medium — `.gitignore` and `/tmp/pi-render-cache-plan-clean.md` Task 6: ignoring `.pi-subagents/` does not keep it out of a tarball if it was ever tracked, and ignore rules are not a packaging control.** The `files` allowlist is the primary boundary; the automated tarball assertion must be authoritative. Add the ignore entry for workspace hygiene, but do not treat it as release evidence.

14. **Medium — overall eight-task scope: coherent themes, but too much risk is coupled into one release train.** The plan combines benchmark infrastructure, a behaviorally delicate cache expansion, runtime self-check redesign, dependency/lockfile restoration, packaging, docs, and live performance certification. The dependencies are mostly sensible, but maintenance risk is lower if Tasks 1/5/6 and the CI/package fixes ship independently from Tasks 2–4/8. At minimum add explicit checkpoints after harness correctness, styled feasibility, and tarball validation.

## Residual risks

- Runtime module identity may still differ between the local benchmark and pi’s loader alias unless it is attested from inside the host process.
- A fingerprint based on executing user/style callbacks repeatedly can introduce side effects even when the renderer later falls back; delivery approval should require explicit safety tests and documentation.
- Wildcard peers can expose the extension to future incompatible pi/pi-tui releases before maintainers test them; runtime disabling limits corruption but can still leave users without the advertised benefit.
- CPU improvements on one Apple/Node configuration may not generalize across supported Node versions, ICU builds, operating systems, terminal widths, and model chunk patterns.
- A source-checkout benchmark can be reproducible while the published npm artifact remains unverifiable if scripts and status evidence are excluded.

## Verdict

**Not release-ready as planned.** The technical work is directionally well decomposed, but CI ownership, shipped-tool/package coherence, compatibility policy, automated tarball validation, and the placement/definition of performance gates must be resolved before implementation is considered release-safe.

**Maturity: 6/10.**

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "BLIND_review_4.md contains 14 concrete findings with severity and paths/task references, plus a dedicated residual-risks section."
    }
  ],
  "changedFiles": [
    "docs/research/plan-review/BLIND_review_4.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Project tests, package commands, and git commands",
      "result": "not-run",
      "summary": "Review-only task; execution was unnecessary and would not add evidence about the plan text."
    }
  ],
  "validationOutput": [
    "Reviewed only /tmp/pi-render-cache-plan-clean.md, package.json, README.md, and .gitignore as required.",
    "The review artifact ends with verdict, maturity score, concrete review findings, and residual risks."
  ],
  "residualRisks": [
    "No commands were run to validate future scripts because the requested artifact is a plan review and those scripts do not yet exist.",
    "Repository staged-file state was not inspected because the task restricted reads to four named inputs; no staging command was executed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested blind delivery/maintenance review artifact; no project, source, or plan file was modified.",
  "reviewFindings": [
    "blocker: /tmp/pi-render-cache-plan-clean.md Tasks 1/6 - CI behavior is required but no workflow deliverable owns it.",
    "high: package.json files - planned compat/benchmark scripts and upstream-status documentation would be excluded from the published package despite advertised commands.",
    "high: /tmp/pi-render-cache-plan-clean.md Task 6 - npm pack --dry-run is reporting, not an automated package allowlist assertion.",
    "high: /tmp/pi-render-cache-plan-clean.md Tasks 3-8 - the styled-feature rollback decision comes after dependent release work.",
    "high: package.json peerDependencies - wildcard compatibility claims are not reconciled with validation only on pi 0.82.1.",
    "high: /tmp/pi-render-cache-plan-clean.md Task 8 - manual CPU protocol is insufficiently controlled for reproducible published claims."
  ],
  "manualNotes": "Verdict: not release-ready as planned; maturity 6/10."
}
```
