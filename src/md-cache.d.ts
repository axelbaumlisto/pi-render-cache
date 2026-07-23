export interface MarkdownCacheStats {
	hits: number;
	misses: number;
	fallbacks: number;
	chars: number;
	size: number;
}

export interface MarkdownConstructor {
	new (...args: any[]): any;
	prototype: { render(width: number): string[] };
}

export function install(options: {
	Markdown: MarkdownConstructor;
	getCapabilities?: () => { hyperlinks: boolean };
	budgetChars?: number;
}): void;
export function uninstall(): void;
export function getStats(): MarkdownCacheStats;
