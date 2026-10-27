import fs from "node:fs";
import path from "node:path";
import { CACHE } from "../paths.ts";
import { checkout } from "../backfill/git.ts";
import { realSource } from "../backfill/source.ts";
import { run } from "../webbundle.ts";
import type {
  HistoricLaunch,
  HistorySpec,
  Pin,
  SuiteId,
  Variant,
} from "./types.ts";

const REPO = "ScratchEverywhere/ScratchEverywhere";
const WORKFLOW = "nightly-pc.yml";
const ARTIFACTS = {
  headless: "Scratch Everywhere! Linux Headless Nightly",
  gui: "Scratch Everywhere! Linux SDL2 Nightly",
} as const;
const DIR = path.join(CACHE, "backfill", "scratch-everywhere");

const gh = async (...args: string[]): Promise<string> => {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new Error(`gh ${args.join(" ")}: ${err.trim()}`);
  }
  return out;
};

const ciRun = async (sha: string): Promise<string | null> => {
  const runs = JSON.parse(
    await gh(
      "run",
      "list",
      "-R",
      REPO,
      "--workflow",
      WORKFLOW,
      "--commit",
      sha,
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId",
    ),
  );
  return runs[0] ? String(runs[0].databaseId) : null;
};

const fromArtifact = async (
  runId: string,
  kind: keyof typeof ARTIFACTS,
  dest: string,
): Promise<string> => {
  const bin = path.join(dest, "scratch-pc");
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(dest, { recursive: true });
    await gh(
      "run",
      "download",
      runId,
      "-R",
      REPO,
      "-n",
      ARTIFACTS[kind],
      "-D",
      dest,
    );
    fs.chmodSync(bin, 0o755);
  }
  return bin;
};

const localHeadless = async (sha: string, dest: string): Promise<string> => {
  const src = path.join(dest, "src");
  const build = path.join(dest, "build");
  await checkout(REPO, sha, src);
  await run([
    "cmake",
    "-S",
    src,
    "-B",
    build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DSE_RENDERER=headless",
    "-DSE_WINDOWING=headless",
    "-DSE_AUDIO_ENGINE=headless",
    "-DSE_AUDIO=OFF",
  ], dest);
  await run([
    "cmake",
    "--build",
    build,
    "-j",
    String(Math.max(2, navigator.hardwareConcurrency - 2)),
  ], dest);
  const bin = ["scratch-pc", "scratch-everywhere"].map((n) =>
    path.join(build, n)
  ).find((p) => fs.existsSync(p));
  if (!bin) {
    throw new Error(
      "the build produced no scratch-pc or scratch-everywhere executable",
    );
  }
  const kept = path.join(dest, "scratch-pc");
  fs.copyFileSync(bin, kept);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(build, { recursive: true, force: true });
  return kept;
};

const containsCommit = async (sha: string, base: string): Promise<boolean> => {
  try {
    const status = (await gh(
      "api",
      `repos/${REPO}/compare/${base}...${sha}`,
      "--jq",
      ".status",
    )).trim();
    return status === "ahead" || status === "identical";
  } catch {
    return false;
  }
};

const hasAudioFix = (sha: string) => containsCommit(sha, "99e3c7d4");

export const hasBytecodeVm = (sha: string) => containsCommit(sha, "4cb9003d");

const settingsFile = (sb3: string) => `${sb3}.json`;
const removeSettings = (sb3: string) =>
  fs.rmSync(settingsFile(sb3), { force: true });

export const vmVariants = (bytecode: boolean): Variant[] =>
  bytecode
    ? [
      {
        id: "bytecode",
        name: "bytecode VM",
        default: true,
        prepare: removeSettings,
      },
      {
        id: "interpreter",
        name: "interpreter",
        default: false,
        prepare: (sb3) =>
          fs.writeFileSync(
            settingsFile(sb3),
            JSON.stringify({ settings: { useBytecode: false } }),
          ),
      },
    ]
    : [{
      id: "interpreter",
      name: "interpreter",
      default: true,
      prepare: removeSettings,
    }];

const resolve = async (date: string): Promise<Pin | null> => {
  const sha = await realSource.gitHead(REPO, date, { branch: "main" });
  return sha ? { parts: [], custom: { version: sha.slice(0, 7), sha } } : null;
};

const build = async (pin: Pin, suite: SuiteId): Promise<HistoricLaunch> => {
  const sha = pin.custom!.sha!;
  const dir = path.join(DIR, sha);
  let runId: string | null = null;
  try {
    runId = await ciRun(sha);
  } catch {}

  if (suite === "parity") {
    if (!runId) throw new Error(`no nightly CI run for ${sha.slice(0, 7)}`);
    const bin = await fromArtifact(runId, "gui", path.join(dir, "gui"));
    return {
      display: true,
      command: (sb3) => ({ cmd: [bin, sb3], cwd: path.dirname(bin) }),
    };
  }

  let bin: string;
  let note: string | undefined;
  try {
    if (!runId) throw new Error("no CI run");
    if (!(await hasAudioFix(sha))) {
      throw new Error("CI binary predates the headless audio fix");
    }
    bin = await fromArtifact(runId, "headless", path.join(dir, "headless"));
  } catch {
    bin = path.join(dir, "local-v2", "scratch-pc");
    if (!fs.existsSync(bin)) {
      await localHeadless(sha, path.join(dir, "local-v2"));
    }
    note =
      "local_build: built from source with the CI headless flags; CI had no usable artifact";
  }
  const env = note
    ? {
      ...(process.env as Record<string, string>),
      SDL_AUDIODRIVER: "dummy",
      SDL_VIDEODRIVER: "dummy",
    }
    : undefined;
  return {
    note,
    command: (sb3) => ({ cmd: [bin, sb3], cwd: path.dirname(bin), env }),
  };
};

export const scratchEverywhereHistory: HistorySpec = {
  since: { performance: "2026-10-04", parity: "2026-10-05" },
  variants: async (pin) => vmVariants(await hasBytecodeVm(pin.custom!.sha!)),
  custom: { resolve: (date) => resolve(date), build },
};
