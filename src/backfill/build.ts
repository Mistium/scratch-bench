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
import { buildDirPart, install, fixLockfiles, pinToDate, pinToLockfile, run, SCRIPTS } from "../webbundle.ts";
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

/** The spec's parts for a pinned repo, which know every directory the build needs (not only the ones the pin names). */
const specsFor = (rt: Runtime, repo: string): GitPart[] =>
  rt.history?.parts?.filter(isGitSpec).filter((p) => p.git === repo) ?? [];

const pinDirs = (
  rt: Runtime,
  p: Extract<PinPart, { git: string }>,
): string[] => {
  return [
    ...Object.values(p.provides),
    ...(p.shared ?? []),
    ...specsFor(rt, p.git).flatMap((s) => [
      ...Object.values(s.provides),
      ...(s.shared ?? []),
    ]),
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
    // A monorepo's imported history has its packages at their new paths but no workspace root yet, so make one
    // listing the packages that commit has.
    const pkg = fs.existsSync(pkgFile)
      ? JSON.parse(fs.readFileSync(pkgFile, "utf8"))
      : {
        name: "bench-workspace",
        private: true,
        workspaces: sparse.filter((d) => fs.existsSync(path.join(work, d, "package.json"))),
      };
    // Keep only the checked-out packages; the root may list them by name or by a glob such as "packages/*".
    const listed: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
    pkg.workspaces = sparse.filter((d) =>
      fs.existsSync(path.join(work, d, "package.json")) &&
      listed.some((w) => w === d || (w.endsWith("/*") && path.dirname(d) === w.slice(0, -2)))
    );
    delete pkg.scripts?.prepare;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    log("installing the workspace");
    await install(work);
    const needed = new Set([...Object.values(p.provides), ...(p.shared ?? [])]);
    // Packages build against each other's output (scratch-vm needs scratch-render's dist), so build in passes: a
    // package that fails is tried again once another has built, until a pass builds nothing new.
    const build = (w: string) =>
      // Older packages build with webpack 4, which needs the legacy OpenSSL provider; newer ones ignore it.
      run(["bun", "run", "build"], path.join(work, w), {
        NODE_OPTIONS: "--openssl-legacy-provider",
        NODE_ENV: "development",
      })
        .then(() => null, (e) => (/script not found|Script not found|no "build"/i.test(String(e)) ? null : e));
    let pending = pkg.workspaces as string[];
    const errors = new Map<string, unknown>();
    while (pending.length) {
      const failed: string[] = [];
      for (const w of pending) {
        log(`building ${w}`);
        const e = await build(w);
        if (e) {
          failed.push(w);
          errors.set(w, e);
        } else errors.delete(w);
      }
      if (failed.length === pending.length) break;
      pending = failed;
    }
    for (const [w, e] of errors) {
      if (fs.existsSync(path.join(work, w, "dist"))) {
        log(`${w} built with errors; using its output`);
      } else if (needed.has(w)) throw e;
      else log(`${w} did not build; not needed for this suite`);
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

/**
 * Webpack accepts files that mix require() with import/export, but Node loads them as ES modules, where require() does
 * not exist (penguinmod-port's src/serialization/pm-compat.js). Rewrite those to CommonJS, as webpack would treat them.
 */
const cjsifyMixedModules = async (src: string) => {
  if (!fs.existsSync(src)) return;
  const { transformSync } = await import("esbuild");
  for (const name of fs.readdirSync(src, { recursive: true }) as string[]) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(src, name);
    const code = fs.readFileSync(file, "utf8");
    if (!/\brequire\(/.test(code) || !/^\s*(export|import)\s/m.test(code)) continue;
    fs.writeFileSync(file, transformSync(code, { loader: "js", format: "cjs", target: "node18" }).code);
  }
};

/** Performance: a directory the Node adapter can require() as the scratch-vm. */
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
      fixLockfiles(work);
      pinToLockfile(work);
      await pinToDate(work);
      for (
        const lock of ["package-lock.json", "yarn.lock", "npm-shrinkwrap.json"]
      ) fs.rmSync(path.join(work, lock), { force: true });
      await run(["bun", "install", "--production", "--ignore-scripts"], work);
    }
    await cjsifyMixedModules(path.join(repo.dir(part.provides.vm!), "src"));
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

/** Free the disk a finished pin used (checkouts and node_modules), keeping only what a run still needs. */
/** Deletes a version's build once it has been run; a retry rebuilds it. */
export const cleanup = (hash: string) => {
  fs.rmSync(buildPath(hash), { recursive: true, force: true });
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
