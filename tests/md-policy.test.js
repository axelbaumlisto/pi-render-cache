/**
 * The markdown cache is off where it was measured to cost more than it saves.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { MD_ENV, markdownCachePolicy } from "../src/md-policy.js";

test("off on pi 1.x, where the host caches renders itself", () => {
  const { install, reason } = markdownCachePolicy({
    piVersion: "1.0.2",
    env: {},
  });

  assert.equal(install, false);
  assert.match(reason, /0\.83x/);
});

test("on for the pi line that rebuilds every streamed chunk", () => {
  assert.equal(
    markdownCachePolicy({ piVersion: "0.84.1", env: {} }).install,
    true,
  );
});

test("an unknown version is treated as new, because only the harm is measured", () => {
  assert.equal(
    markdownCachePolicy({ piVersion: null, env: {} }).install,
    false,
  );
  assert.equal(
    markdownCachePolicy({ piVersion: "not-a-version", env: {} }).install,
    false,
  );
});

test("the environment overrides the policy in both directions", () => {
  assert.equal(
    markdownCachePolicy({ piVersion: "1.0.2", env: { [MD_ENV]: "1" } }).install,
    true,
  );
  assert.equal(
    markdownCachePolicy({ piVersion: "0.84.1", env: { [MD_ENV]: "0" } })
      .install,
    false,
  );
});
