export interface ReloadLifecycle {
	isCurrent(): boolean;
	schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
	dispose(): void;
}

export function createReloadLifecycle(options?: {
	globalObject?: Record<PropertyKey, unknown>;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}): ReloadLifecycle;
