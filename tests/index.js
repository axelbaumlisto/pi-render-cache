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
