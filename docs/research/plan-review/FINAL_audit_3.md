# FINAL_audit_3 — Edge-case / security audit of shipped runtime paths

**Role:** EDGE-CASE / SECURITY critic (Phase 5, first-pass).
**Scope:** shipped runtime paths only — `src/md-cache.js`, `src/seg-cache.js`,
`src/patch-state.js`, `src/split.js`, `src/stats.js`, `extensions/index.ts`,
`scripts/check-upstream.mjs`, `scripts/resolve-pi.mjs`.
**Method:** read-only static review + empirical Node experiments run against the **real**
modules and the **real** pi 0.82.1 install
(`/Users/shamash/local/lib/node_modules/@earendil-works/pi-coding-agent`, pi-tui 0.82.1,
Node 22.23.0, ICU 78.2). Every claim below marked **PoC-verified** was reproduced by executing
the actual shipped code (experiments lived in `/tmp`, no project file was modified).

Threat model assumed: the extension defends *correctness and stability* of the host pi
process against **benign-but-weird** inputs (unusual themes, foreign wrappers, races,
reloads) and fails safe. A **co-resident malicious extension** shares the same JS process and
can already patch anything; the code explicitly documents that source hashes "are
compatibility gates, NOT authentication." Findings that require an in-process hostile actor
are noted as such and weighted accordingly.

---

## Findings

### 1. THE KEY QUESTION — WeakMap theme-signature memoization is stale; per-render output fingerprint is the real gate
**Severity: MINOR (correctness preserved by defense-in-depth; one documented residual class)**
**File:** `src/md-cache.js:39` (`THEME_SIGNATURE_CACHE = new WeakMap()`), `:84-106` (`themeSignature`), `:121` (`themeFingerprint`), `:224-228` (call site).

`themeSignature(theme)` memoizes the validated signature **by object identity** in a module-level
`WeakMap` (`:85-86` return the memo before any re-validation; `:106` sets it once). The memo is
**never re-validated** for that object.

**PoC-verified** (real pi theme, real patched render):
- Memoized the signature for `theme`, then **replaced** `theme.heading` with
  `(s)=>"INJECTED["+s+"]"` on the *same object*. The next render **passed the signature gate**
  (stale memo) and produced `INJECTED` output — counter delta was `misses+1, hits+0, fallbacks+0`.
- **However**, the injected render was stored under a **new cache key**, not served as a stale hit,
  because `themeFingerprint` re-probes **all 15 callbacks + codeBlockIndent twice per render**
  (`:121-157`) and the changed `heading` output changed the fingerprint → changed key.
- Reverting `theme.heading` and re-rendering served the **original clean entry byte-identical**;
  the injected value **did not** leak into the clean-theme render (no cross-contamination).
- A **stateful** callback (different output each call) post-memo → fingerprint first≠second probe
  → returns `null` → **clean fallback** to the original renderer (`fallbacks+1`), never cached.
- **Adding an unknown own key** post-memo (e.g. `theme.extraFutureField`) → render completed
  without crash; the added key is invisible to both the (stale) signature and the fixed fingerprint.

**Residual risk (the only mutation class that slips past BOTH gates):** the fingerprint is a
**fixed allowlist of 16 probed components** (`:122-149`). If pi's renderer ever consumes a theme
input **outside** that set, mutating that input post-memo would change render output while leaving
both the signature and the fingerprint unchanged → a stale/incorrect prefix could be served from
cache. For the **currently allowlisted pi 0.80.7/0.82.1 theme surface** the 16 probes cover every
renderer-consumed field, so this is **latent**, not active. It is also explicitly documented
("matching callbacks must be deterministic, side-effect-free, and input-transparent"). **Net:**
identity-keyed memoization is safe *today* only because the per-render output fingerprint
compensates; the WeakMap provides no mutation safety on its own.

### 2. TOCTOU: `install()` re-adopt branch reassigns the prototype with no writable re-check → uncaught TypeError at load
**Severity: MINOR (crash on a narrow mid-process race; degrades to extension-load failure, not host corruption)**
**File:** `src/seg-cache.js:107-109` (re-adopt `Intl.Segmenter.prototype.segment = existing.patched`),
`src/md-cache.js:295-299` (same for `render`); reached via `src/patch-state.js:185` (`setupSeg`→`installSeg`)
because `evaluateSegSupport` returns **`adopt`** (not `unsupported`) on this branch.

When shared state **survives** (e.g. a foreign teardown restored the pristine `orig` to the
prototype but left `globalThis[STATE_KEY]`) **and** the prototype property is then made
non-writable (another extension locking `Intl.Segmenter.prototype.segment` down mid-process),
`evaluateSegSupport` sees `current === shared.orig` and returns `adopt`. `setupSeg` proceeds into
`install()`, whose re-adopt branch does `prototype.segment = existing.patched` **without any
descriptor re-check** → `TypeError: Cannot assign to read only property`, escaping **uncaught**
from the extension default export.

**PoC-verified:** fresh install → restore `orig` to prototype (state survives) →
`defineProperty(segment,{writable:false,configurable:true})` → `evaluateSegSupport()` = `adopt` →
`setupSeg()` **threw** `TypeError` at seg-cache.js:108.
The **cold** path (no surviving state) is correctly gated: `evaluateSegSupport` returns
`unsupported` and `setupSeg` returns **before** calling `install()` (`patch-state.js:181-184`) —
PoC-verified no-throw. Only the re-adopt race is exposed.

### 3. Ownership guard only fires when prior shared state exists; a *fresh* install silently layers over a foreign wrapper
**Severity: MINOR (requires a co-resident hostile/buggy extension; documented non-authentication)**
**File:** `src/md-cache.js:290` (`const orig = Markdown.prototype.render`), `:302`;
`src/seg-cache.js:114` (`orig: Intl.Segmenter.prototype.segment`).

On a **fresh** install (no `globalThis[STATE_KEY]`), `install()` captures whatever is currently on
the prototype as `orig` and stacks its wrapper on top. If another extension already wrapped
`Markdown.prototype.render` / `Intl.Segmenter.prototype.segment`, this **layers** rather than
detecting the foreign function. The "never layer / ownership-lost" logic (`md-cache.js:283-289`,
`seg-cache.js:104-112`) only runs when prior shared state exists.

**PoC-verified (seg):** put a foreign wrapper on `Intl.Segmenter.prototype.segment`, called
`seg.install()` fresh → `installed:true`, and the foreign wrapper was invoked *through* our patch
(layered). For **md** the production path is normally saved by the allowlist: `evaluateMdSupport`
(`patch-state.js:91`) hashes `current.toString()` and a foreign wrapper's source doesn't match →
`unsupported` → refuse. **But** the hash is djb2 of `fn.toString()` and `evaluateMdSupport` calls
`current.toString()` (not `Function.prototype.toString.call`), so an **own `toString` override**
on the foreign fn reproduces the pristine source and **defeats the gate** — PoC-verified
(`evaluateMdSupport` returned `install` for a `toString`-spoofed foreign fn). Impact: a spoofed
orig returning a non-array then crashes every md render (finding 4). This is **documented**
("not authentication") and needs an in-process hostile actor, so it stays minor.

### 4. Patched `render()` does not validate `orig`'s return shape before `.reduce` / `.concat`; a bad orig crashes uncaught
**Severity: MINOR (unreachable with the real allowlisted renderer; reachable only via finding 3's spoof)**
**File:** `src/md-cache.js:243` (`prefixLines = orig.call(...)`), `:245`
(`prefixLines.reduce(...)`), `:256` (`tailLines = orig.call(...)`), `:259` (`prefixLines.concat(tailLines)`).

The `try/catch` in the patched render (`:212-235`) wraps **only key-building** (split, signature,
fingerprint, capability). The subsequent `orig.call(...)` results are used with **no `Array.isArray`
guard and no try/catch**. If `orig` ever returns a non-array, `prefixLines.reduce` throws and the
exception **escapes to pi's render loop** rather than degrading to the fallback path.

**PoC-verified:** with a spoofed/foreign `orig` (finding 3) returning `"evil-non-array"`, the first
cache-miss render threw `TypeError: prefixLines.reduce is not a function` at `md-cache.js:245`,
propagating out of `render()`. With the genuine allowlisted renderer this is unreachable (orig
always returns `string[]`), and a direct post-install mutation of `state.orig` does **not** trigger
it because `makePatchedRender` destructured `orig` into a closure at install time (`:158`) — so the
exposure is solely "hostile orig captured at install." Still, a one-line `Array.isArray` guard
falling back to `orig.call(this,width)` would close it cheaply.

### 5. `makeBudgetCache.set` has no cost-validation: NaN permanently disables eviction, negative cost corrupts accounting
**Severity: MINOR (not reachable from shipped call sites — costs are sums of `.length`/counts)**
**File:** `src/stats.js:44-52` (`set`), `:45` (`cost > budgetChars` guard), `:46` (`while (chars + cost > budgetChars)`).

`set(key, value, cost)` validates only `cost > budgetChars`. **PoC-verified:**
- `set("a","A",NaN)` → stored; `chars` becomes `NaN`; every later `chars + cost > budgetChars` is
  `false` → **the eviction loop never runs again** → the map grows **unbounded** (inserted 10,000
  entries under a budget of 100; `size` 10001, `chars` NaN). This breaks the "bounded storage" claim.
- `set("a","A",-500)` → stored; `chars` −500; subsequent entries over-admitted (negative headroom).
- `cost = Infinity` correctly rejected (`Infinity > budget`); `budget = 0` stores a zero-cost entry.

**Reachability:** both shipped producers compute `retainedCost` as sums of `.length` and record
counts (`md-cache.js:244-246`, `seg-cache.js:82-86`) — always finite integers ≥ 0, never NaN/negative
from real input. So this is a **latent robustness gap**, not an active hazard; a defensive
`Number.isFinite(cost) && cost >= 0` guard would harden it against future callers.

### 6. Synchronous unbounded `readFileSync` + `JSON.parse` of `compatibility.json` on the extension-load thread
**Severity: INFORMATIONAL / MINOR (foot-gun only; malformed input is handled safely)**
**File:** `extensions/index.ts:39` (`JSON.parse(fs.readFileSync(url,"utf8"))`), `:38-46`.

`loadAllowlistHashes()` reads and parses `compatibility.json` **synchronously** at extension load
with no size cap. **PoC-verified:** a 7.5 MB file with 200,000 hash entries parsed in ~233 ms —
that is a **~233 ms TUI freeze on startup** for a large file, scaling linearly. Malformed input is
handled correctly: malformed JSON → `[]`; non-object / array `implementationHashes` → `[]`;
non-object entries skipped; empty-string hashes filtered; a `__proto__` version key does **not**
pollute (`({}).polluted === undefined`) because `Object.values` + property reads don't assign. The
only issue is the **blocking read of an unbounded file** on the interactive thread. Since
`compatibility.json` ships with the package and is not attacker-controlled at runtime, impact is low.

### 7. `scripts/resolve-pi.mjs` PATH/symlink handling — no loop, clean actionable errors
**Severity: NONE (verified safe)**
**File:** `scripts/resolve-pi.mjs:63,81,93` (`realpathSync`), `:41-50` (`findPackageRootUp`), `:91` (`execFileSync`).

**PoC-verified:** `PI_PACKAGE_ROOT` → self-referential symlink loop → `realpathSync` throws →
caught → clean "does not exist" error. A `package.json` symlink loop → `readPkg` returns null →
clean "not a package root" error. The upward walk in `findPackageRootUp` terminates at the fs root
via `parent === dir` (`:46`), so **no infinite loop** is possible through symlinked ancestors.
`execFileSync("which"|"where", ["pi"])` uses an arg array (no shell) → no injection via PATH.
Missing nested pi-tui → actionable throw. No finding.

---

## Verified NON-issues (checked, no defect)

- **Double-install / reinstall race:** two back-to-back `install()` calls → second **adopts**,
  prototype function identity unchanged (no layering), wrapper depth stays 1 (`[C3]`).
  `/reload` (fresh module scope, `?reload=1`) → **adopts** via shared `globalThis` symbol, prototype
  stable (`[F2]`). `uninstall()` restores the pristine original cleanly (`[C4]`, `[F2]`).
- **Frozen theme object (`Object.freeze`):** cannot be mutated → no memo-staleness; render
  byte-equal to pristine (`[F3]`).
- **Empty theme `{}`:** routes through the guard to the original renderer and throws **identically**
  to pristine pi (`this.theme.underline is not a function`) — the extension adds **no** new failure
  mode; it delegates exactly as un-patched pi would.
- **Proxy theme whose `ownKeys` throws:** caught by the `try/catch` → clean fallback, no propagation.
- **Markdown subclass:** inherits the patched render; byte-equal output.
- **Frozen `Intl.Segmenter.prototype.segment` (cold path):** `evaluateSegSupport` → `unsupported`,
  `setupSeg` refuses before touching the prototype; no throw, prototype untouched.
- **seg-cache:** non-string input delegates to native; >4 KB strings bypass cache; frozen/fresh
  double-install adopt; uninstall restores pristine.

## Residual risks

1. **Latent:** any *future* pi renderer-consumed theme input outside the fixed 16-probe fingerprint
   allowlist could be mutated post-memoization and served stale (finding 1). Mitigated today by full
   coverage of the 0.80.7/0.82.1 theme surface; worth a comment/assert pinning the probed set to the
   allowlisted theme contract.
2. **Narrow race:** mid-process freezing of the patched prototype during a state-surviving re-adopt
   crashes extension load (finding 2). Low probability; bounded to extension-load failure.
3. **In-process hostile actor:** a co-resident malicious extension can defeat the djb2/`toString`
   gate (finding 3) and trigger an uncaught md-render crash via a non-array return (finding 4).
   Documented as out of threat model ("not authentication"), but findings 3+4 chain into a
   denial-of-render; a cheap `Array.isArray` guard and `Function.prototype.toString.call` would
   shrink it.
4. **Startup latency:** a very large `compatibility.json` blocks the TUI thread for ~233 ms+ at load
   (finding 6). Foot-gun only.

---

## VERDICT: **minor-only** (no blocking findings)

All findings are MINOR or INFORMATIONAL. Every verified hazard is either (a) unreachable from the
shipped/allowlisted code paths, (b) requires a co-resident hostile actor that the docs already place
out of scope, or (c) degrades to a bounded failure (extension-load refusal/crash) rather than host
corruption or wrong rendered output. The critical correctness invariant — **byte-identical output**
— held in every experiment, including theme mutation, reload, double-install, frozen theme, subclass,
and adversarial orig. The identity-keyed WeakMap signature memoization (the assigned key question) is
**stale by design but safe in practice** because the per-render output fingerprint re-validates the
actual rendered surface and prevents both stale hits and cross-contamination.

**Maturity: 8 / 10.**

Strong: conservative fallback-at-any-doubt design, byte-equality preserved under every attack tried,
clean ownership/adopt semantics on the happy paths, malformed-config fails closed, thorough
documentation of the non-authentication stance. Points off for: the un-guarded `orig` return-shape
dereference (4), the re-adopt writable-check TOCTOU (2), the un-validated cache `cost` (5), and the
reliance on a fixed fingerprint allowlist whose completeness is asserted but not enforced against the
theme contract (1). All are one-to-three-line hardening fixes, none blocking.
