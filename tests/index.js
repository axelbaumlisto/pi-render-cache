/**
 * Entry point so `node --test plugins/render-cache/test/` works on Node 22.x,
 * where a directory arg is resolved as a module entry (not scanned for tests).
 * Import every *.test.js here — this file IS the full suite.
 */
import "./smoke.test.js";
import "./split.test.js";
import "./seg-cache.test.js";
import "./md-cache.test.js";
import "./extension.test.js";
import "./theme-resolve.test.js";
import "./managed-install.test.js";
import "./live-module.test.js";
import "./reach-line.test.js";
import "./metrics.test.js";
import "./transform-option.test.js";
import "./md-policy.test.js";
