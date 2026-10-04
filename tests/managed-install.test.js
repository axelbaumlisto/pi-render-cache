// pi >= 1.0.1 managed install: a shell launcher on PATH, the package under
// <agentDir>/install/releases/<version>/node_modules/. Walking up from the
// launcher finds nothing, which is what blinded /rcstats, compat and the
// benchmarks on an updated host.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const resolver = fileURLToPath(
  new URL("../scripts/resolve-pi.mjs", import.meta.url),
);

/** Build a fake managed install and a `pi` launcher on PATH; returns its bin dir. */
function managedHome(version, { currentVersion = version, extraRelease } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-managed-"));
  const agent = join(home, ".pi", "agent");
  const bin = join(agent, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "pi"), 0o755);
  const make = (v) => {
    const root = join(
      agent,
      "install",
      "releases",
      v,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    mkdirSync(join(root, "node_modules", "@earendil-works", "pi-tui"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: v }),
    );
    writeFileSync(
      join(root, "node_modules", "@earendil-works", "pi-tui", "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-tui",
        version: v,
        main: "index.js",
      }),
    );
    writeFileSync(
      join(root, "node_modules", "@earendil-works", "pi-tui", "index.js"),
      "export const x = 1;\n",
    );
  };
  make(version);
  if (extraRelease) make(extraRelease);
  if (currentVersion !== null) {
    writeFileSync(
      join(agent, "install", "current-version"),
      `${currentVersion}\n`,
    );
  }
  return { home, bin };
}

function resolveWith(bin, home) {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(resolver)}); const r = m.resolvePiRoot(); console.log(JSON.stringify({ version: r.version, source: r.source }));`,
    ],
    {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, PI_PACKAGE_ROOT: "" },
    },
  );
  return JSON.parse(out.trim().split("\n").at(-1));
}

test("a managed install is resolved through current-version", () => {
  const { home, bin } = managedHome("1.0.2");
  try {
    const r = resolveWith(bin, home);
    assert.equal(r.version, "1.0.2");
    assert.equal(r.source, "managed-install");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a sole release is accepted when current-version is missing", () => {
  const { home, bin } = managedHome("1.0.3", { currentVersion: null });
  try {
    assert.equal(resolveWith(bin, home).version, "1.0.3");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("several releases without current-version are not guessed between", () => {
  const { home, bin } = managedHome("1.0.2", {
    currentVersion: null,
    extraRelease: "1.0.3",
  });
  try {
    assert.throws(() => resolveWith(bin, home), /Cannot locate|Command failed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a stale current-version falls back to nothing rather than a wrong release", () => {
  const { home, bin } = managedHome("1.0.2", { currentVersion: "9.9.9" });
  try {
    assert.throws(() => resolveWith(bin, home), /Cannot locate|Command failed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
