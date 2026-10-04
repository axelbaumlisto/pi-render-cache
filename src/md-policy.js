/**
 * Whether caching markdown is worth doing on this pi.
 *
 * It is not, from pi 1.0 on. Upstream added its own render cache — lines are
 * kept per component and width — and a Markdown instance already keeps the
 * lines it last produced. Four live sessions (240, 98, 85 and 76 MB), scrolled
 * through their history and streamed into, produced 222 misses and not one
 * hit: the host never asks for the same text twice.
 *
 * Worse than useless, measured: same work, same classes pi runs, 6600 lines,
 * five runs, medians — 87.3 ms with no patch, 104.7 ms with the markdown cache
 * (0.83x), and that is WITH 240 hits out of 360. Building the key costs a theme
 * fingerprint probe and a hash of the whole text, which is now more expensive
 * than the render it replaces.
 *
 * The segment cache is a different story and stays on: 81.3 ms, 1.07x.
 *
 * Older pi still rebuilt the whole message per streamed chunk, so the cache
 * keeps earning its keep there. An unknown version is treated as new, because
 * the harm is measured and the benefit is not.
 */
export const MD_ENV = "PI_RENDER_CACHE_MD";

/** @returns {{install: boolean, reason: string}} */
export function markdownCachePolicy({ piVersion, env = process.env }) {
  const forced = env[MD_ENV];
  if (forced === "1") return { install: true, reason: `forced by ${MD_ENV}=1` };
  if (forced === "0")
    return { install: false, reason: `disabled by ${MD_ENV}=0` };

  const major = Number.parseInt(String(piVersion ?? "").split(".")[0], 10);
  if (!Number.isFinite(major)) {
    return {
      install: false,
      reason: `pi version unknown; off by default (set ${MD_ENV}=1 to force)`,
    };
  }
  if (major >= 1) {
    return {
      install: false,
      reason: `pi ${piVersion} caches renders itself; measured 0.83x with this on`,
    };
  }
  return {
    install: true,
    reason: `pi ${piVersion} rebuilds each streamed chunk`,
  };
}
