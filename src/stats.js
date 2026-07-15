/**
 * Shared cache plumbing for both patchers (seg-cache, md-cache):
 * one FIFO char-budget cache implementation + one counters shape. (DRY, see PLAN.md)
 */

/** @returns {{hits: number, misses: number, fallbacks: number}} */
export function makeCounters() {
	return { hits: 0, misses: 0, fallbacks: 0 };
}

/**
 * Map-backed cache capped by TOTAL CACHED CHARS. Eviction is honest FIFO:
 * when an insert would exceed the budget, the first-inserted keys are dropped
 * until the new entry fits. Entries costing more than the whole budget are
 * silently not cached (caller still gets its value; nothing breaks).
 *
 * @param {number} budgetChars total char budget across all entries
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
		 * @param {number} cost char cost of this entry
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
