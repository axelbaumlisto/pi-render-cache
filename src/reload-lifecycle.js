/**
 * Session-scoped timer owner that is safe across Pi runtime replacement.
 *
 * A newly loaded extension instance supersedes every older instance. Old
 * callbacks become no-ops even if clearTimeout races with callback dispatch.
 */
const INSTANCE_KEY = Symbol.for("render-cache:extension-instance:v1");

export function createReloadLifecycle({
	globalObject = globalThis,
	setTimeoutFn = setTimeout,
	clearTimeoutFn = clearTimeout,
} = {}) {
	const token = Symbol("render-cache-extension-instance");
	const timers = new Set();
	let disposed = false;
	globalObject[INSTANCE_KEY] = token;

	const isCurrent = () => !disposed && globalObject[INSTANCE_KEY] === token;

	function schedule(callback, delayMs) {
		if (disposed) throw new Error("render-cache lifecycle is disposed");
		let timer;
		timer = setTimeoutFn(() => {
			timers.delete(timer);
			if (!isCurrent()) return;
			callback();
		}, delayMs);
		timers.add(timer);
		timer?.unref?.();
		return timer;
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		for (const timer of timers) clearTimeoutFn(timer);
		timers.clear();
		// Never invalidate a newer instance that already superseded this one.
		if (globalObject[INSTANCE_KEY] === token) delete globalObject[INSTANCE_KEY];
	}

	return { isCurrent, schedule, dispose };
}
