export interface SegmentCacheStats {
	hits: number;
	misses: number;
	fallbacks: number;
	size: number;
	chars: number;
	budgetChars: number;
}

export function install(options?: { budgetChars?: number }): void;
export function uninstall(): void;
export function getStats(): SegmentCacheStats;
