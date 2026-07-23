import { test } from "node:test";
import assert from "node:assert/strict";
import { createReloadLifecycle } from "../src/reload-lifecycle.js";

function fakeClock() {
	let nextId = 1;
	const callbacks = new Map();
	const cleared = [];
	return {
		callbacks,
		cleared,
		setTimeoutFn(callback) {
			const timer = { id: nextId++, unref() {} };
			callbacks.set(timer, callback);
			return timer;
		},
		clearTimeoutFn(timer) {
			cleared.push(timer);
			callbacks.delete(timer);
		},
	};
}

test("reload supersedes old callbacks before they can use stale ctx", () => {
	const globalObject = {};
	const oldClock = fakeClock();
	const oldLifecycle = createReloadLifecycle({ globalObject, ...oldClock });
	let oldCalls = 0;
	const oldTimer = oldLifecycle.schedule(() => oldCalls++, 2000);
	const oldCallback = oldClock.callbacks.get(oldTimer);

	// Pi emits session_shutdown before loading the replacement runtime. Keep a
	// retained callback to model a timer that was already queued despite clearTimeout.
	oldLifecycle.dispose();
	const newClock = fakeClock();
	const newLifecycle = createReloadLifecycle({ globalObject, ...newClock });
	let newCalls = 0;
	const newTimer = newLifecycle.schedule(() => newCalls++, 2000);

	// Simulate the race where the old timer was already queued before shutdown.
	oldCallback();
	assert.deepEqual(oldClock.cleared, [oldTimer], "session shutdown clears the old timer");
	assert.equal(oldCalls, 0, "disposed old callback must be a no-op");
	assert.equal(newLifecycle.isCurrent(), true);

	newClock.callbacks.get(newTimer)();
	assert.equal(newCalls, 1, "current instance callback still runs");
});

test("old shutdown cannot invalidate a newer extension instance", () => {
	const globalObject = {};
	const oldClock = fakeClock();
	const oldLifecycle = createReloadLifecycle({ globalObject, ...oldClock });
	const oldTimer = oldLifecycle.schedule(() => assert.fail("old timer ran"), 2000);

	const newLifecycle = createReloadLifecycle({ globalObject, ...fakeClock() });
	oldLifecycle.dispose();

	assert.deepEqual(oldClock.cleared, [oldTimer], "shutdown clears old timer");
	assert.equal(newLifecycle.isCurrent(), true, "new instance remains current");
});

test("dispose is idempotent and scheduling after shutdown is rejected", () => {
	const clock = fakeClock();
	const lifecycle = createReloadLifecycle({ globalObject: {}, ...clock });
	const timer = lifecycle.schedule(() => {}, 2000);
	lifecycle.dispose();
	lifecycle.dispose();
	assert.deepEqual(clock.cleared, [timer]);
	assert.equal(lifecycle.isCurrent(), false);
	assert.throws(() => lifecycle.schedule(() => {}, 1), /disposed/);
});
