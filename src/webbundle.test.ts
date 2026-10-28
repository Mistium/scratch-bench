import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pinToLockfile } from "./webbundle.ts";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const setup = (lock: unknown) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { "scratch-blocks": "latest", left: "^1.0.0" }, devDependencies: { webpack: "^4.0.0" } }),
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
  return () => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
};

test("pins direct dependencies to an npm v1 lockfile, leaving unlocked ones alone", () => {
  const read = setup({
    lockfileVersion: 1,
    dependencies: { "scratch-blocks": { version: "0.1.0-prerelease.20200528193139" }, webpack: { version: "4.46.0" } },
  });
  pinToLockfile(dir);
  expect(read()).toEqual({
    dependencies: { "scratch-blocks": "0.1.0-prerelease.20200528193139", left: "^1.0.0" },
    devDependencies: { webpack: "4.46.0" },
  });
});

test("pins direct dependencies to an npm v2+ lockfile", () => {
  const read = setup({ lockfileVersion: 3, packages: { "node_modules/scratch-blocks": { version: "1.1.210" } } });
  pinToLockfile(dir);
  expect(read().dependencies["scratch-blocks"]).toBe("1.1.210");
});

test("leaves git dependencies alone: their lockfile version is only a placeholder", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      dependencies: {
        "scratch-storage": "github:PenguinMod/PenguinMod-Storage#develop",
        "scratch-parser": "PenguinMod/scratch-parser",
        "scratch-render": "^0.1.0",
        left: "^1.0.0",
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/scratch-storage": { version: "0.0.0-development", resolved: "git+ssh://git@github.com/x.git#abc" },
        "node_modules/scratch-parser": { version: "0.0.0-development", resolved: "git+ssh://git@github.com/y.git#def" },
        "node_modules/scratch-render": { version: "0.1.0", resolved: "git+ssh://git@github.com/z.git#123" },
        "node_modules/left": { version: "1.2.3", resolved: "https://registry.npmjs.org/left/-/left-1.2.3.tgz" },
      },
    }),
  );
  pinToLockfile(dir);
  expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).dependencies).toEqual({
    "scratch-storage": "github:PenguinMod/PenguinMod-Storage#develop",
    "scratch-parser": "PenguinMod/scratch-parser",
    "scratch-render": "^0.1.0",
    left: "1.2.3",
  });
});

test("bun installs take turns while other commands run alongside them", async () => {
  const { run } = await import("./webbundle.ts");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "turns-"));
  // A fake `bun` on PATH that records when each install starts and ends.
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const log = path.join(dir, "log");
  fs.writeFileSync(path.join(bin, "bun"), `#!/bin/sh\necho "start $2" >> ${log}\nsleep 0.2\necho "end $2" >> ${log}\n`);
  fs.chmodSync(path.join(bin, "bun"), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const saved = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    await Promise.all([run(["bun", "install", "a"], dir), run(["bun", "install", "b"], dir)]);
  } finally {
    process.env.PATH = saved;
  }
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  expect(lines.map((l) => l.split(" ")[0])).toEqual(["start", "end", "start", "end"]);
});

test("dependency ranges are pinned to the newest version published by the commit date", async () => {
  const { pinToDate } = await import("./webbundle.ts");
  const { CACHE } = await import("./paths.ts");
  const name = "bench-pin-to-date-fixture";
  fs.mkdirSync(path.join(CACHE, "registry-times"), { recursive: true });
  fs.writeFileSync(
    path.join(CACHE, "registry-times", `${name}.json`),
    JSON.stringify({ "2.0.0": "2025-01-01T00:00:00.000Z", "2.1.0": "2025-06-01T00:00:00.000Z", "2.2.0": "2026-01-01T00:00:00.000Z" }),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-date-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { [name]: "^2.0.0", exact: "1.0.0" } }));
  const env = { ...process.env, GIT_COMMITTER_DATE: "2025-09-01T00:00:00Z", GIT_AUTHOR_DATE: "2025-09-01T00:00:00Z" };
  for (const cmd of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"]]) {
    Bun.spawnSync(["git", ...cmd], { cwd: dir, env });
  }
  await pinToDate(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  expect(pkg.dependencies[name]).toBe("2.1.0");
  expect(pkg.dependencies.exact).toBe("1.0.0");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(CACHE, "registry-times", `${name}.json`), { force: true });
});
