/**
 * Shared cache plumbing for both patchers (seg-cache, md-cache):
 * one FIFO retained-cost-budget cache implementation + one counters shape.
 * Cost units are conservative caller estimates, not source-character counts;
 * 1,024 units represent ≈1 KiB of estimated retention, not measured heap bytes.
 */

/** @returns {{hits: number, misses: number, fallbacks: number}} */
export function makeCounters() {
  return { hits: 0, misses: 0, fallbacks: 0, reasons: {} };
}

/**
 * Map-backed cache capped by total caller-estimated retained cost. Eviction is honest FIFO:
 * when an insert would exceed the budget, the first-inserted keys are dropped
 * until the new entry fits. Entries costing more than the whole budget are
 * silently not cached (caller still gets its value; nothing breaks).
 *
 * @param {number} budgetChars total conservative retained-cost units across entries
 */
export function makeBudgetCache(budgetChars = 2_000_000) {
  const map = new Map(); // key → { value, cost }; Map preserves insertion order → FIFO
  let chars = 0;
  return {
    get budgetChars() {
      return budgetChars;
    },
    get size() {
      return map.size;
    },
    get chars() {
      return chars;
    },
    /** @returns {unknown | undefined} */
    get(key) {
      const entry = map.get(key);
      return entry === undefined ? undefined : entry.value;
    },
    /**
     * @param {string} key
     * @param {unknown} value
     * @param {number} cost caller-supplied estimated retained cost of this entry
     */
    set(key, value, cost) {
      if (cost > budgetChars || map.has(key)) return;
      while (chars + cost > budgetChars && map.size > 0) {
        const oldestKey = map.keys().next().value;
        chars -= map.get(oldestKey).cost;
        map.delete(oldestKey);
      }
      map.set(key, { value, cost });
      chars += cost;
    },
    clear() {
      map.clear();
      chars = 0;
    },
  };
}

/**
 * One line saying where the patch sits and whether the renderer ever called it.
 *
 * "active" only means installed. Reporting that alone is what let this
 * extension sit dead for six weeks after pi inlined its TUI into its own
 * bundle, so a patch nobody calls has to say so in plain words.
 */
export function reachLine(rendererSource, counters) {
  const calls = counters.hits + counters.misses + counters.fallbacks;
  return calls === 0
    ? `patched ${rendererSource} | NOT REACHING THE RENDERER (0 calls)`
    : `patched ${rendererSource} | ${calls} calls`;
}
