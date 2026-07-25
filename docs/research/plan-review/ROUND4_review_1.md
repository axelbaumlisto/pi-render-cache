# ROUND 4 — Final blind convergence review (reviewer 1, strategy only)

Sources read (blind protocol): `/tmp/pi-render-cache-plan-round4-clean.md`, `package.json`,
`src/md-cache.js`, `src/seg-cache.js`, `src/stats.js`, `extensions/index.ts`. No docs/research,
no prior reviews, no git history.

Question answered: does any NEW strategic blocker remain that makes the plan internally
contradictory or unimplementable?

**Short answer: one sequencing contradiction remains (Checkpoint A memory gate vs Task 4 fix);
everything else is mechanical polish.**

---

## 1. Theme support contract coherence — COHERENT

Safety decision 2 + Task 4 now form a closed, honest contract:

- Gating is shape (exact own-key set) + `Function.prototype.toString()` hashes against an
  allowlisted core implementation. Both operations are possible without *invoking* theme render
  callbacks, so "non-matching custom themes fall back without classification calls"
  (Task 4 step 2, Verification checklist) is implementable.
- The previously fatal circularity (probe-then-promise-pristine-fallback) is explicitly resolved:
  Task 4 step 3 states that a *matching* but contract-violating (stateful/spoofed) callback may
  already have been probed and is therefore "explicitly unsupported rather than promised pristine
  fallback." Safety decision 2 says the same ("compatibility gating, not authentication").
  The safety promise and the gating mechanism no longer contradict each other.
- Output fingerprinting (bounded probes over the full renderer-consumed surface) is only performed
  *after* signature match, i.e., only under the documented deterministic/pure contract. Consistent.

Minor (mechanical) residue:

- **Note (low), plan §Safety-2 / Task 4 step 2:** `src/md-cache.js:12-14` documents that pi's theme
  is "a proxy over globalThis." Reading own keys / retrieving functions for the signature check
  will execute proxy `ownKeys`/`get` traps. The plan's phrase "without invoking functions" is true
  for theme *callbacks* but property reads are unavoidable (the current code already reads
  `this.defaultTextStyle` etc.). One sentence defining "classification calls" as "invoking theme
  render callbacks" would close the last ambiguity. Mechanical wording only.
- **Note (low):** Task 4 does not say whether the (shape + 16× toString-hash) signature check is
  memoized per theme-object identity. Since pi creates a fresh theme object per streaming rebuild
  (Safety decision 2), a WeakMap memo gives one check per rebuild; without it the check runs every
  render. Either is correct; cost is µs-scale and the benchmark of Task 3 will surface it anyway.
  Implementation detail, not strategic.

## 2. Cache memory accounting feasibility — FEASIBLE, but see §6 sequencing finding

Task 4 step 6 (conservative retained key + value size for md-cache; key/input + wrapper/array +
per-record overhead for seg-cache; hard per-entry/total limits) is directly implementable on top of
`src/stats.js` `makeBudgetCache` — the `cost` parameter is caller-supplied, so richer accounting
needs no structural change to the cache. Evidence of the real gap the task fixes:

- `src/seg-cache.js:68` charges only `str.length`, but the cached value is an array of one record
  object per grapheme (`{segment, index, input}`, `seg-cache.js:14-17`), ~56–100 bytes each in V8.
  A 2,000,000-char budget of distinct Unicode lines can retain on the order of 100+ MiB — orders
  of magnitude beyond the accounted "chars."
- `src/md-cache.js:126` charges `settled.length`, but the cached value is rendered ANSI line
  arrays, typically several times larger than the source, plus the key itself
  (`md-cache.js:95-103`) which *contains* the full settled text — currently uncharged.

So the accounting plan is not just feasible; it is necessary, and the plan's "worst-case
high-segment-count tests" target exactly the worst case above. `/rcstats` "labels estimates
honestly" is the right epistemic stance. No blocker here per se.

## 3. Fixture-lock reproducibility — FEASIBLE

Checked-in per-fixture `package-lock.json` with exact versions + integrities, installed via
`npm ci` into an isolated temp root, selected via `PI_PACKAGE_ROOT`, with hash/realpath
verification (Task 1 steps 4–5) is a sound, reproducible design. pi/pi-tui are pure-JS packages,
so integrity hashes are platform-independent; Node/ICU variance is recorded as environment
metadata (Task 3 step 8), not baked into fixtures. The "one compatibility unit" decision (Safety
decision 3) removes the version-skew degrees of freedom that would otherwise break reproducibility.

- **Note (low), Task 1 Files list:** `npm ci` requires a `package.json` adjacent to the lockfile;
  the Files list names only `fixtures/compat/<v>/package-lock.json`. Either check in the fixture
  `package.json` too, or have `install-fixture.mjs` deterministically generate it. Mechanical
  omission, one-line fix.
- The dual-branch handling of the pi-tui wildcard peer (remove if types resolve through pi,
  otherwise pin per fixture and attest coherence — Compatibility contract + Task 6 step 2) is
  internally consistent with the current `package.json:31-39` wildcard problem it fixes.

## 4. Two-route retirement logic — COHERENT

The two routes are mutually exclusive and exhaustive on the deciding predicate ("patch has no
reachable work/hits" vs "remains active with nonzero work"), so no case falls between routes.
The statistical route's contrasts match Task 3 step 7 verbatim (md: combined/seg-only and
md-only/baseline; seg: combined/md-only and seg-only/baseline), denominators are consistently the
no-patch mode, the three-outcome classification forbids inverting failed equivalence into a
difference claim, the intersection rule is correctly noted as conservative w.r.t. false
equivalence, and environment-scoped retirement ("patch stays elsewhere") prevents overreach.
Memory uses the same paired replay-delta methodology as Checkpoints A/B — consistent metric family.

- **Fix needed (low, editorial), §Retirement protocol, structural route:** the sentence ends
  "removal is ." — the verdict word is missing (presumably "permitted"/"safe"). As written the
  route's conclusion is formally unspecified. Trivial editorial fix, but in a release-gating
  document the operative verb should exist.

## 5. Checkpoint executability — EXECUTABLE

Both checkpoints name concrete scripts, a single Verify command, machine pass/fail, and nonzero
exit codes (Checkpoint A step 1; Checkpoint B acceptance). Dependency ordering is sound: Task 2's
per-patch `active`/`unsupported` states exist before Task 3's activity checks consume them;
Checkpoint A's "structurally inapplicable, not equivalent" classification (via Task 3 step 7)
correctly handles the styled workload where md-cache legitimately falls back
(`src/md-cache.js:68-77`). Checkpoint B's scope (matrix + suite + premise + lifecycle + bytes +
memory) is a superset composed of already-built pieces — executable by construction.

## 6. The one remaining strategic finding

- **Blocker-adjacent (medium), Checkpoint A vs Task 4 — gating deadlock on the memory bound.**
  Checkpoint A gates on "+20 MiB replay-delta RSS versus paired control" and runs *before* Task 4
  ("Task 4 Depends: Checkpoint A"). But as shown in §2, the *current* seg-cache accounting
  (`src/seg-cache.js:68`, `src/stats.js` char budget) permits ~100+ MiB retained record objects
  on exactly the Unicode-line replay workload Task 3 mandates. So Checkpoint A's memory gate is
  likely to fail for a reason whose designated fix (Task 4 step 6) is dependency-blocked behind
  Checkpoint A itself. The plan says performance magnitude is "reported, not gated" at A, but
  memory *is* gated at A — that asymmetry creates the only internal contradiction I can find.
  **One-sentence resolution:** at Checkpoint A, report memory and gate only
  structural/activity/correctness/sample validity; enforce the +20 MiB bound at Checkpoint B
  (where it already appears, post-Task-4). Alternatively: predeclare that an A-stage memory
  failure routes into Task 4 rather than halting. Either amendment fully dissolves the issue.

## Verdict

Everything else in the plan — theme contract, compatibility unit, blocked/paired benchmark design,
lifecycle states, evidence custody, retirement statistics — is internally consistent and
implementable against the code as it exists today. Apart from finding §6 and three low-severity
editorial/mechanical notes (§1 proxy-trap wording, §3 fixture package.json, §4 truncated
sentence), **only mechanical polish remains.**

- **Decision: CONDITIONAL GO** — condition: resolve the Checkpoint A memory-gate sequencing
  (one predeclared sentence, either option in §6). No other strategic blocker found.
- **Maturity: 9/10.**
- **Strategic vs mechanical:** 1 strategic-sequencing item (§6, trivially amendable);
  3 mechanical items; 2 informational notes.
