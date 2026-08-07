# pi-render-cache 0.84.1 compatibility and fleet release

## Context

pi 0.84.1 changed `Markdown.prototype.render` by adding the Markdown transformer hook, producing hash `cea3fb87`. The hot paths remain present, but pi-render-cache 1.1.0 safely disables md-cache because 0.84.1 is not allowlisted. The plugin is installed locally and on five unique remote hosts spanning pi 0.80.2–0.84.1.

## Approach

Add 0.84.1 as an exact tested compatibility unit, run deterministic correctness and release gates, publish a patch release, deploy it to every discovered host, and collect identical blocked A/B replay evidence per host without pooling environments.

## Tasks

### Task 1: Add exact pi 0.84.1 compatibility
**Files:** `compatibility.json`, `fixtures/compat/0.84.1/package.json`, `fixtures/compat/0.84.1/package-lock.json`, `package.json`, `package-lock.json`, `README.md`, `docs/UPSTREAM_STATUS.md`
**Acceptance:** 0.84.1/pi-tui 0.84.1 is locked with Markdown hash `cea3fb87`; selected-unit and full compatibility matrix pass.
**Verify:** `npm run verify && npm run compat:matrix`
**Steps:**
1. Add the exact compatibility row/hash and locked fixture.
2. Move the default development compatibility unit to 0.84.1.
3. Update compatibility/upstream documentation.
4. Run deterministic verification and matrix.

### Task 2: Produce release evidence and publish patch
**Files:** `package.json`, `package-lock.json`, `README.md`, `docs/UPSTREAM_STATUS.md`, `evidence/v1.1.1/summary.json`
**Depends:** Task 1
**Acceptance:** Full 20-block release replay is byte-identical, structural/activity/memory gates pass, exact tarball is published as 1.1.1, tag and repository are pushed.
**Verify:** `npm run release:verify`, evidence promotion, `npm pack --dry-run --json`, `npm view pi-render-cache version`
**Steps:**
1. Run full local release verification on pi 0.84.1.
2. Promote sanitized evidence and update measured claims.
3. Bump to 1.1.1, verify, commit/tag/push, and publish.

### Task 3: Deploy and benchmark the complete fleet
**Files:** remote pi package stores; local `/tmp/pi-render-cache-fleet-*` artifacts
**Depends:** Task 2
**Acceptance:** Local plus spex, gene, grep_app, astra-prod, and cont run the same blocked baseline/seg/md/both corpus; every cut point is byte-identical; published 1.1.1 is installed everywhere; host/version/environment and ratios are reported separately.
**Verify:** remote `pi list`, package version readback, blocked benchmark evaluator per host.
**Steps:**
1. Install/update npm:pi-render-cache on every unique host.
2. Run fixed 3-block ecological A/B independently per host using its installed pi compatibility unit.
3. Collect artifacts and report failures or unsupported old pi versions without pooling results.

## Verification

- [ ] 84 deterministic tests and typecheck pass
- [ ] 0.80.7, 0.82.1, and 0.84.1 exact compatibility fixtures pass
- [ ] Full local 20-block release evidence passes byte-equality/activity/memory gates
- [ ] npm 1.1.1, git commit/tag, and GitHub push agree
- [ ] Every unique plugin host runs 1.1.1
- [ ] Fleet A/B results remain environment-scoped and byte-identical
