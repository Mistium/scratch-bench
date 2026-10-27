import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../paths.ts";
import {
  hasBytecodeVm,
  scratchEverywhereHistory,
  vmVariants,
} from "./scratch-everywhere-history.ts";
import type { Runtime, SetupInfo } from "./types.ts";

const REPO = "ScratchEverywhere/ScratchEverywhere";
const WORKFLOW = "nightly-pc.yml";
const ARTIFACTS = {
  headless: "Scratch Everywhere! Linux Headless Nightly",
  gui: "Scratch Everywhere! Linux SDL2 Nightly",
} as const;
const ROOT_DIR = path.join(RUNTIME_DIR, "scratch-everywhere");

interface Build {
  id: string;
  sha: string;
  date: string;
  headless: string;
  gui: string;
}
let build: Build | undefined;

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
    throw new Error(`gh ${args.join(" ")} failed: ${err.trim()}`);
  }
  return out;
};

const download = async (): Promise<Build> => {
  const runs = JSON.parse(
    await gh(
      "run",
      "list",
      "-R",
      REPO,
      "--workflow",
      WORKFLOW,
      "--branch",
      "main",
      "--event",
      "push",
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId,headSha,createdAt",
    ),
  );
  if (!runs.length) {
    throw new Error(`no successful ${WORKFLOW} run on main found in ${REPO}`);
  }
  const id = String(runs[0].databaseId);
  const dir = path.join(ROOT_DIR, id);
  const bins: Record<string, string> = {};
  for (const [kind, artifact] of Object.entries(ARTIFACTS)) {
    const dest = path.join(dir, kind);
    const bin = path.join(dest, "scratch-pc");
    if (!fs.existsSync(bin)) {
      fs.mkdirSync(dest, { recursive: true });
      await gh("run", "download", id, "-R", REPO, "-n", artifact, "-D", dest);
      if (!fs.existsSync(bin)) {
        throw new Error(`artifact "${artifact}" has no scratch-pc binary`);
      }
      fs.chmodSync(bin, 0o755);
    }
    fs.mkdirSync(path.join(dest, "scratch-everywhere"), { recursive: true });
    bins[kind] = bin;
  }
  const b: Build = {
    id,
    sha: runs[0].headSha,
    date: runs[0].createdAt,
    headless: bins.headless,
    gui: bins.gui,
  };
  fs.writeFileSync(
    path.join(ROOT_DIR, "latest.json"),
    JSON.stringify(b, null, 2),
  );
  return b;
};

const cached = (): Build => {
  const file = path.join(ROOT_DIR, "latest.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "no cached Scratch Everywhere! build; run without --offline once",
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const binary = (kind: "headless" | "gui"): string => {
  const override =
    process.env[kind === "headless" ? "SE_BINARY" : "SE_GUI_BINARY"];
  if (override) return override;
  if (!build) throw new Error("Scratch Everywhere! was not set up");
  return build[kind];
};

export const scratchEverywhere: Runtime = {
  id: "scratch-everywhere",
  name: "Scratch Everywhere!",
  kind: "native",
  history: scratchEverywhereHistory,
  async setup({ offline }): Promise<SetupInfo> {
    if (process.env.SE_BINARY && process.env.SE_GUI_BINARY) {
      return {
        version: "custom",
        detail: {
          headless: process.env.SE_BINARY,
          gui: process.env.SE_GUI_BINARY,
        },
      };
    }
    build = offline ? cached() : await download();
    return {
      version: `${build.sha.slice(0, 7)} (run ${build.id})`,
      detail: { sha: build.sha, run: build.id, built: build.date },
      variants: vmVariants(await hasBytecodeVm(build.sha)),
    };
  },
  headless: {
    command: (sb3) => ({
      cmd: [binary("headless"), sb3],
      cwd: path.dirname(binary("headless")),
    }),
  },
  gui: {
    display: true,
    command: (sb3) => ({
      cmd: [binary("gui"), sb3],
      cwd: path.dirname(binary("gui")),
    }),
  },
};
