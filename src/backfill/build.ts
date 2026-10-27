import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, CACHE, ROOT } from "../paths.ts";
import type {
  GitPart,
  HistoricLaunch,
  HistoryPart,
  NpmPart,
  Pin,
  PinPart,
  Runtime,
  SuiteId,
} from "../runtimes/types.ts";
import { buildDirPart, install, run, SCRIPTS } from "../webbundle.ts";
import { checkout, sparseDirs } from "./git.ts";

export const BUILDS = path.join(CACHE, "backfill", "builds");
export const buildPath = (hash: string) => path.join(BUILDS, hash);

type Log = (line: string) => void;
type PartName = keyof typeof SCRIPTS;
const ORDER: PartName[] = ["vm", "render", "svg", "storage", "audio"];

const isGitPin = (p: PinPart): p is Extract<PinPart, { git: string }> =>
  "git" in p;
const isGitSpec = (p: HistoryPart): p is GitPart => "git" in p;
const isNpmSpec = (p: HistoryPart): p is NpmPart => "npm" in p;

const specFor = (rt: Runtime, repo: string): GitPart | undefined =>
  rt.history?.parts?.filter(isGitSpec).find((p) => p.git === repo);

const pinDirs = (
  rt: Runtime,
  p: Extract<PinPart, { git: string }>,
): string[] => {
  const spec = specFor(rt, p.git);
  return [
    ...Object.values(p.provides),
    ...(p.shared ?? []),
    ...Object.values(spec?.provides ?? {}),
    ...(spec?.shared ?? []),
  ];
};

const prepareRepo = async (
  rt: Runtime,
  p: Extract<PinPart, { git: string }>,
  work: string,
  log: Log,
): Promise<
  { root: string; dir: (sub: string) => string; workspace: boolean }
> => {
  const dirs = pinDirs(rt, p);
  const sparse = sparseDirs(dirs);
  log(
    `checkout ${p.git}@${p.commit.slice(0, 7)}${
      sparse.length ? ` (${sparse.join(", ")})` : ""
    }`,
  );
  await checkout(p.git, p.commit, work, sparse);
  const workspace = sparse.length > 0;
  if (workspace) {
    const pkgFile = path.join(work, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    const keep = new Set(sparse);
    pkg.workspaces = (Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces?.packages ?? []).filter((w: string) =>
        keep.has(w)
      );
    delete pkg.scripts?.prepare;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    log("installing the workspace");
    await run(["bun", "install", "--ignore-scripts"], work);
    const needed = new Set([...Object.values(p.provides), ...(p.shared ?? [])]);
    for (const w of pkg.workspaces as string[]) {
      log(`building ${w}`);
      await run(["bun", "run", "build"], path.join(work, w), {
        NODE_ENV: "development",
      }).catch((e) => {
        if (
          /script not found|Script not found|no "build"/i.test(String(e))
        ) return;
        if (fs.existsSync(path.join(work, w, "dist"))) {
          return log(`${w} built with errors; using its output`);
        }
        if (needed.has(w)) throw e;
        log(`${w} did not build; not needed for this suite`);
      });
    }
  }
  return {
    root: work,
    dir: (sub) => (sub === "." ? work : path.join(work, sub)),
    workspace,
  };
};

const npmPartBundle = async (
  p: Extract<PinPart, { npm: string }>,
  out: string,
  tmp: string,
  log: Log,
) => {
  log(`npm ${p.npm}@${p.version}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    '{"name":"x","private":true}',
  );
  await run(["bun", "add", "--ignore-scripts", `${p.npm}@${p.version}`], tmp);
  const pkgDir = path.join(tmp, "node_modules", p.npm);
  if (fs.existsSync(path.join(pkgDir, "dist/web"))) {
    fs.cpSync(path.join(pkgDir, "dist/web"), out, { recursive: true });
  } else {
    await buildDirPart(p.provides as PartName, pkgDir, out, "esbuild", {
      installed: true,
    });
  }
};

const buildBundle = async (
  rt: Runtime,
  pin: Pin,
  hash: string,
  log: Log,
): Promise<string> => {
  const base = buildPath(hash);
  const bundle = path.join(base, "bundle");
  const work = path.join(base, "work");
  fs.rmSync(bundle, { recursive: true, force: true });
  const have = new Set<string>();

  for (const [n, part] of pin.parts.entries()) {
    if (isGitPin(part)) {
      const repo = await prepareRepo(rt, part, path.join(work, String(n)), log);
      for (const [name, sub] of Object.entries(part.provides)) {
        if (!fs.existsSync(repo.dir(sub))) {
          throw new Error(
            `${part.git}@${
              part.commit.slice(0, 7)
            } has no ${sub} yet (the ${name} part)`,
          );
        }
        log(`bundling ${name}`);
        const how = name === "audio" ? "esbuild" : "webpack";
        await buildDirPart(
          name as PartName,
          repo.dir(sub),
          path.join(bundle, name),
          how,
          { installed: repo.workspace },
        );
        have.add(name);
      }
    } else {
      await npmPartBundle(
        part,
        path.join(bundle, part.provides),
        path.join(work, `npm-${n}`),
        log,
      );
      have.add(part.provides);
    }
  }
  for (const name of ORDER) {
    if (!have.has(name)) throw new Error(`the pin has no ${name} part`);
    if (!fs.existsSync(path.join(bundle, name, SCRIPTS[name]))) {
      throw new Error(`${name} produced no ${SCRIPTS[name]}`);
    }
  }
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    JSON.stringify(
      {
        recipe: hash,
        scripts: ORDER.map((n) => `${n}/${SCRIPTS[n]}`),
      },
      null,
      2,
    ),
  );
  fs.rmSync(work, { recursive: true, force: true });
  return bundle;
};

const buildVmDir = async (
  rt: Runtime,
  pin: Pin,
  hash: string,
  log: Log,
): Promise<string> => {
  const base = buildPath(hash);
  const work = path.join(base, "work");
  const part = pin.parts.find((
    p,
  ) => (isGitPin(p) ? "vm" in p.provides : p.provides === "vm"));
  if (!part) throw new Error("the pin has no vm part");

  if (isGitPin(part)) {
    const repo = await prepareRepo(rt, part, work, log);
    if (!repo.workspace) {
      log("installing runtime dependencies");
      for (
        const lock of ["package-lock.json", "yarn.lock", "npm-shrinkwrap.json"]
      ) fs.rmSync(path.join(work, lock), { force: true });
      await run(["bun", "install", "--production", "--ignore-scripts"], work);
    }
    return repo.dir(part.provides.vm!);
  }
  const tmp = path.join(base, "npm");
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    '{"name":"x","private":true}',
  );
  await run(
    ["bun", "add", "--ignore-scripts", `${part.npm}@${part.version}`],
    tmp,
  );
  return path.join(tmp, "node_modules", part.npm);
};

export const cleanup = (hash: string, keep: "bundle" | "none") => {
  const base = buildPath(hash);
  if (keep === "none") fs.rmSync(base, { recursive: true, force: true });
  else fs.rmSync(path.join(base, "work"), { recursive: true, force: true });
};

export const buildLaunch = async (
  rt: Runtime,
  suite: SuiteId,
  pin: Pin,
  hash: string,
  log: Log = () => {},
): Promise<HistoricLaunch> => {
  const spec = rt.history;
  if (!spec) throw new Error(`${rt.id} has no history spec`);
  if (spec.custom) return spec.custom.build(pin, suite);

  const marker = path.join(buildPath(hash), "built.json");
  let info: { kind: "bundle" | "vm"; path: string };
  if (fs.existsSync(marker)) {
    info = JSON.parse(fs.readFileSync(marker, "utf8"));
  } else {
    fs.rmSync(buildPath(hash), { recursive: true, force: true });
    fs.mkdirSync(buildPath(hash), { recursive: true });
    info = suite === "parity"
      ? { kind: "bundle", path: await buildBundle(rt, pin, hash, log) }
      : { kind: "vm", path: await buildVmDir(rt, pin, hash, log) };
    fs.writeFileSync(marker, JSON.stringify(info));
  }

  return info.kind === "bundle"
    ? {
      command: (sb3) => ({
        cmd: ["node", path.join(ADAPTERS, "chromium-vm.mjs"), rt.id, sb3],
        cwd: ROOT,
        env: {
          ...(process.env as Record<string, string>),
          BENCH_BUNDLE_DIR: info.path,
        },
      }),
    }
    : {
      command: (sb3) => ({
        cmd: ["node", path.join(ADAPTERS, "node-vm.mjs"), rt.id, sb3],
        cwd: ROOT,
        env: {
          ...(process.env as Record<string, string>),
          BENCH_VM_DIR: info.path,
        },
      }),
    };
};
