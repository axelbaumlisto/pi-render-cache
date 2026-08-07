# Release evidence custody

Controlled benchmark raw results contain host paths and detailed environment metadata. They remain untracked in `.bench-results/` during local work and are retained as immutable CI release artifacts for a release validation run.

Only compact sanitized summaries are tracked here, under `evidence/<release>/summary.json`. Create one with:

```sh
node scripts/promote-evidence.mjs \
  --input .bench-results/premise-raw.json \
  --release vX.Y.Z
```

Promotion verifies the checked-in replay corpus hash, byte-identical result hashes, and compatibility-unit consistency. The summary records the raw file SHA-256 so an artifact can be matched to its tracked summary without publishing private paths.

## Dependency model

The package keeps a wildcard pi peer range for runtime host flexibility; the pi-tui extension import resolves through the host pi installation rather than an independent pi-tui peer. Development dependencies pin both packages to the tested `0.84.1` compatibility unit so clean-clone typechecking and default CI resolution are deterministic. Exact older fixtures remain lockfile-pinned and are exercised by the on-demand compatibility matrix.
