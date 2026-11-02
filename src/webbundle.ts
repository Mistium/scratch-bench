import { onCleanup } from "./cleanup.ts";
import { errorSummary } from "./measure.ts";
import fs from "node:fs";
import path from "node:path";
import { CACHE, ROOT, RUNTIME_DIR } from "./paths.ts";

export type WebPart = {
  name: "vm" | "render" | "svg" | "storage" | "audio";
  dep: string;
  how: "webpack" | "esbuild" | "dist";
};

export interface WebRecipe {
  id: string;
  parts: WebPart[];
}

export const SCRIPTS: Record<WebPart["name"], string> = {
  vm: "scratch-vm.js",
  render: "scratch-render.js",
  svg: "scratch-svg-renderer.js",
  storage: "scratch-storage.js",
  audio: "audio.js",
};

const WEB_DIR = path.join(RUNTIME_DIR, "web");
const SRC_DIR = path.join(RUNTIME_DIR, "src");

// Parallel `bun install`s share bun's package cache and can trip over each other ("failed opening cache/package/...
// dir"), so installs take turns; everything else still runs in parallel.
let installQueue: Promise<unknown> = Promise.resolve();
const isInstall = (cmd: string[]) => cmd[0] === "bun" && (cmd[1] === "install" || cmd[1] === "add");

export const run = (
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> => {
  if (!isInstall(cmd)) return runNow(cmd, cwd, env);
  // Installs take turns, so one that hangs (e.g. on an unreachable registry) would stall every build: give it a limit.
  const turn = installQueue.then(() => runNow(cmd, cwd, env, INSTALL_TIMEOUT_MS));
  installQueue = turn.catch(() => {});
  return turn;
};

const INSTALL_TIMEOUT_MS = 10 * 60_000;

const runNow = async (
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs?: number,
) => {
  // Builds run at low priority so the machine stays reachable under load, and while performance runs are being
  // measured they keep off the measuring cores (see the backfill engine).
  const cpus = process.env.BENCH_BUILD_CPUS;
  // On Linux each build gets its own process group, so stopping the harness also stops what the build started (e.g.
  // the webpack under `bun run build`), instead of leaving it running and holding memory.
  const linux = process.platform === "linux";
  cmd = [
    ...(linux ? ["setsid"] : []),
    "nice",
    "-n",
    "10",
    ...(cpus ? ["taskset", "-c", cpus] : []),
    ...cmd,
  ];
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env } as Record<string, string>,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const kill = () => {
    try {
      process.kill(linux ? -proc.pid : proc.pid, "SIGKILL");
    } catch {}
  };
  const stop = onCleanup(kill);
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => (timedOut = true, kill()), timeoutMs) : undefined;
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  stop();
  if (timedOut) throw new Error(`${cmd.join(" ")} timed out after ${timeoutMs! / 1000}s in ${cwd}`);
  if (code !== 0) {
    const tail = errorSummary(`${err}\n${out}`, 6);
    throw Object.assign(new Error(`${cmd.join(" ")} failed in ${cwd}:\n${tail}`), { output: `${err}\n${out}` });
  }
};

const log = (s: string) => process.stderr.write(`  ${s}\n`);

const installedDir = (dep: string) =>
  fs.realpathSync(path.join(ROOT, "node_modules", dep));

const specOf = async (dep: string): Promise<string> => {
  const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
  const spec = pkg.dependencies?.[dep];
  if (!spec) throw new Error(`${dep} is not a dependency in package.json`);
  return String(spec);
};

const stage = async (dep: string, spec: string) => {
  const key = new Bun.CryptoHasher("sha256").update(spec).digest("hex").slice(
    0,
    10,
  );
  const dir = path.join(SRC_DIR, `${dep}-${key}`);
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(installedDir(dep), dir, {
      recursive: true,
      filter: (src) => path.basename(src) !== "node_modules",
    });
  }
  return dir;
};

/**
 * Pins each direct dependency to the version in the checkout's package-lock.json, when it has one. Bun does not read
 * older npm lockfiles, so a spec like "latest" (TurboWarp in 2020 had `"scratch-blocks": "latest"`) would otherwise
 * install today's release instead of the one the project was built with.
 */
export const pinToLockfile = (dir: string) => {
  const lockFile = path.join(dir, "package-lock.json");
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(lockFile) || !fs.existsSync(pkgFile)) return;
  let lock: any;
  try {
    lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return;
  }
  // Only registry packages: a git dependency's lockfile "version" is a placeholder (e.g. 0.0.0-development) and its
  // package.json spec already names the exact source.
  const entry = (name: string): { version?: string; resolved?: string } | undefined =>
    lock.packages?.[`node_modules/${name}`] ?? lock.dependencies?.[name];
  const fromRegistry = (e?: { resolved?: string }) =>
    !e?.resolved || /^https:\/\/registry\.(npmjs\.org|yarnpkg\.com)\//.test(e.resolved);
  const notRegistrySpec = /^(git|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)|^[\w.-]+\/[\w.-]+(#.*)?$/;
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries<string>(pkg[field] ?? {})) {
      const e = entry(name);
      if (e?.version && fromRegistry(e) && !notRegistrySpec.test(spec)) pkg[field][name] = e.version;
    }
  }
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
};

/**
 * Gets a checkout's lockfiles ready for bun. A repo with a yarn.lock uses yarn, so a package-lock.json beside it is
 * stale (Gandi's scratch-render has one from before its move to Babel 7) and is removed. Lockfiles are pointed at the
 * public npm registry: Gandi's resolve every package through its own mirror (npm.xiguacity.cn), which is unreachable
 * from elsewhere, and the tarball paths are the same as npm's.
 */
const PRIVATE_REGISTRIES = /https?:\/\/(npm\.xiguacity\.cn|registry\.npmmirror\.com|registry\.npm\.taobao\.org)/g;
export const fixLockfiles = (dir: string) => {
  if (fs.existsSync(path.join(dir, "yarn.lock"))) fs.rmSync(path.join(dir, "package-lock.json"), { force: true });
  for (const name of ["yarn.lock", "package-lock.json", ".npmrc"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (name === ".npmrc") {
      if (PRIVATE_REGISTRIES.test(text)) fs.rmSync(file);
      PRIVATE_REGISTRIES.lastIndex = 0;
      continue;
    }
    const fixed = text.replace(PRIVATE_REGISTRIES, "https://registry.npmjs.org");
    if (fixed !== text) fs.writeFileSync(file, fixed);
  }
};

// Publish times of each registry package's versions, from the npm registry, kept on disk between runs.
const REGISTRY_CACHE = path.join(CACHE, "registry-times");
const publishTimes = new Map<string, Promise<Record<string, string> | null>>();
export const timesOf = (name: string) => {
  let times = publishTimes.get(name);
  if (!times) {
    const file = path.join(REGISTRY_CACHE, `${encodeURIComponent(name)}.json`);
    times = (async () => {
      try {
        // A day old at most, so versions published since are seen.
        if (Date.now() - fs.statSync(file).mtimeMs < 86_400_000) return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
      try {
        const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
        if (!res.ok) return null;
        const meta = await res.json() as { time?: Record<string, string>; versions?: Record<string, unknown> };
        const result = Object.fromEntries(
          Object.entries(meta.time ?? {}).filter(([v]) => meta.versions && v in meta.versions),
        );
        fs.mkdirSync(REGISTRY_CACHE, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(result));
        return result;
      } catch {
        return null;
      }
    })();
    publishTimes.set(name, times);
  }
  return times;
};

/** The commit date of a checkout, or null when the directory is not one (e.g. staged inside this repo). */
const commitDate = async (dir: string): Promise<string | null> => {
  const git = async (...args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "ignore" });
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 ? out : "";
  };
  const top = await git("rev-parse", "--show-toplevel");
  if (!top || fs.realpathSync(top) === fs.realpathSync(ROOT)) return null;
  const date = await git("log", "-1", "--format=%cI");
  return date ? new Date(date).toISOString() : null;
};

/**
 * Pins each direct registry dependency that is still a range to the newest matching version published by the
 * checkout's commit date. Without this an old checkout installs today's releases of anything its lockfile does not
 * pin (MistWarp's "rotur-sdk": "^2.0.0" now resolves to a release that webpack 4 cannot parse).
 */
export const pinToDate = async (dir: string) => {
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(pkgFile)) return;
  const date = await commitDate(dir);
  if (!date) return;
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  const exact = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
  const notRegistrySpec = /^(git|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:|npm:)|^[\w.-]+\/[\w.-]+(#.*)?$/;
  let changed = false;
  await Promise.all(["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
    Object.entries<string>(pkg[field] ?? {}).map(async ([name, spec]) => {
      if (exact.test(spec) || notRegistrySpec.test(spec)) return;
      const times = await timesOf(name);
      if (!times) return;
      const range = /^[a-z]+$/i.test(spec) ? "*" : spec; // dist-tags such as "latest"
      const allowPre = range.includes("-");
      let best: string | null = null;
      for (const [version, published] of Object.entries(times)) {
        if (published > date || (!allowPre && version.includes("-"))) continue;
        if (!Bun.semver.satisfies(version, range)) continue;
        if (!best || Bun.semver.order(version, best) > 0) best = version;
      }
      if (best) {
        pkg[field][name] = best;
        changed = true;
      }
    })
  ));
  if (changed) fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
};

export const install = async (dir: string) => {
  if (fs.existsSync(path.join(dir, "node_modules/.bench-installed"))) return;
  fixLockfiles(dir);
  pinToLockfile(dir);
  await pinToDate(dir);
  const locks = ["package-lock.json", "yarn.lock"].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  await run(["bun", "install", "--ignore-scripts"], dir).catch(async (e) => {
    // Bun's migration of an npm lockfile can fail integrity checks (e.g. on git tarballs), and a stale yarn.lock can
    // miss a dependency (ClipCC's scratch-render lacks its clipcc-vm devDependency); resolve without them.
    if (!locks.length) throw e;
    for (const f of locks) fs.rmSync(f);
    await run(["bun", "install", "--ignore-scripts"], dir);
  });
  fs.writeFileSync(path.join(dir, "node_modules/.bench-installed"), "");
};

// Loads a package's webpack.config.js and keeps only the configs that write dist/web, the one bundle the benchmark
// uses. Playground configs resolve dev-only files at load time (MistWarp's has `scratch-blocks/dist/vertical.js`,
// which its scratch-blocks branch does not ship), so a module path that cannot be resolved while loading is let
// through instead of failing the whole config.
// It also gives images a loader when the config has none: some fork commits import them anyway.
const WEB_ONLY = `const Module = require("module");
const path = require("path");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  try {
    return resolve.call(this, request, ...rest);
  } catch (e) {
    if (request.startsWith(".") || !request.includes("/")) throw e;
    return __filename;
  }
};
let config;
try {
  config = require("./webpack.config.js");
} finally {
  Module._resolveFilename = resolve;
}
const web = typeof config === "function" ? [] : [].concat(config).filter((c) =>
  c && c.output && /dist[\\/]web$/.test(path.resolve(c.output.path || ""))
);
let fileLoader;
try { fileLoader = require.resolve("file-loader"); } catch {}
for (const c of web) {
  const rules = (c.module = c.module || {}).rules = c.module.rules || [];
  const handled = (ext) => rules.some((r) => r.test instanceof RegExp && r.test.test("a." + ext));
  const missing = ["png", "jpg", "jpeg", "gif", "svg"].filter((ext) => !handled(ext));
  if (fileLoader && missing.length) {
    rules.push({ test: new RegExp("\\\\.(" + missing.join("|") + ")$"), loader: fileLoader });
  }
}
module.exports = web.length ? web : config;
`;

export const webpack = async (
  dir: string,
): Promise<"production" | "development"> => {
  // In a workspace, webpack-cli may be hoisted to an ancestor's node_modules.
  const rel = "node_modules/webpack-cli/bin/cli.js";
  let d = dir;
  while (!fs.existsSync(path.join(d, rel)) && path.dirname(d) !== d) d = path.dirname(d);
  const cli = fs.existsSync(path.join(d, rel)) ? path.join(d, rel) : rel;
  const cmd = ["node", cli, "--bail"];
  const legacy = { NODE_OPTIONS: "--openssl-legacy-provider" };
  const cmds = [cmd];
  if (fs.existsSync(path.join(dir, "webpack.config.js"))) {
    fs.writeFileSync(path.join(dir, "bench-web.config.js"), WEB_ONLY);
    cmds.unshift([...cmd, "--config", "bench-web.config.js"]);
  }
  let error: unknown;
  for (const NODE_ENV of ["production", "development"] as const) {
    for (const c of cmds) {
      // Each package down-levelled below lets webpack get further, so try again until it builds or nothing is left.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await run(c, dir, { ...legacy, NODE_ENV });
          return NODE_ENV;
        } catch (e) {
          error ??= e;
          if (!(await downlevelUnparsable(dir, (e as { output?: string }).output ?? ""))) break;
        }
      }
    }
  }
  throw error;
};

/**
 * Webpack 4 cannot parse newer syntax such as class fields. When a package in node_modules fails to parse, rewrite its
 * JavaScript to ES2019 with esbuild so the bundle can still be built (MistWarp's rotur-sdk dependency uses class fields).
 * Returns whether any package was rewritten.
 */
const downlevelled = new Set<string>();
const downlevelUnparsable = async (dir: string, output: string): Promise<boolean> => {
  const packages = new Set<string>();
  for (const m of output.matchAll(/ERROR in (\.\/node_modules\/(?:@[^/\s]+\/)?[^/\s]+)[^\n]*\n\s*Module parse failed/g)) {
    packages.add(path.join(dir, m[1]!));
  }
  const { transformSync } = await import("esbuild");
  let rewrote = false;
  // The checkout's own files that its Babel cannot parse (penguinmod-port's renderer uses ??).
  for (const m of output.matchAll(/(?:ERROR in |\[\d+\] )(\.\/(?!node_modules\/)[^\s]+\.js)[^\n]*(?:\[failed\]|\n\s*Module (?:parse|build) failed)/g)) {
    const file = path.join(dir, m[1]!);
    if (!fs.existsSync(file) || downlevelled.has(file)) continue;
    downlevelled.add(file);
    try {
      fs.writeFileSync(file, transformSync(fs.readFileSync(file, "utf8"), { loader: "js", target: "es2019" }).code);
      rewrote = true;
    } catch {}
  }
  for (const pkg of packages) {
    if (!fs.existsSync(pkg) || fs.existsSync(path.join(pkg, ".bench-downlevelled"))) continue;
    for (const file of fs.readdirSync(pkg, { recursive: true }) as string[]) {
      if (!/\.(c|m)?js$/.test(file) || file.split(path.sep).includes("node_modules")) continue;
      const full = path.join(pkg, file);
      try {
        const code = transformSync(fs.readFileSync(full, "utf8"), { loader: "js", target: "es2019" }).code;
        fs.writeFileSync(full, code);
      } catch {}
    }
    fs.writeFileSync(path.join(pkg, ".bench-downlevelled"), "");
    rewrote = true;
  }
  return rewrote;
};

const buildPart = async (
  part: WebPart,
  spec: string,
  out: string,
): Promise<string> => {
  if (part.how === "dist") {
    fs.cpSync(path.join(installedDir(part.dep), "dist/web"), out, {
      recursive: true,
    });
    return "prebuilt";
  }
  const dir = await stage(part.dep, spec);
  return buildDirPart(part.name, dir, out, part.how);
};

export const buildDirPart = async (
  name: WebPart["name"],
  dir: string,
  out: string,
  how: "webpack" | "esbuild",
  { installed = false }: { installed?: boolean } = {},
): Promise<string> => {
  if (!installed) await install(dir);
  if (how === "esbuild") {
    const { buildSync } = await import("esbuild");
    const text = buildSync({
      entryPoints: [path.join(dir, "src/index.js")],
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "ScratchAudio",
      write: false,
    }).outputFiles[0].text;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, SCRIPTS.audio), text);
    return "esbuild";
  }
  const dist = path.join(dir, "dist/web");
  const mode = fs.existsSync(path.join(dist, SCRIPTS[name]))
    ? "cached"
    : await webpack(dir);
  fs.cpSync(dist, out, { recursive: true });
  // Forks that renamed their bundle (clipcc-vm.js, clipcc-render.js): serve it under the usual name.
  const want = path.join(out, SCRIPTS[name]);
  const renamed = fs.existsSync(want) ? undefined : fs.readdirSync(out).find((f) =>
    f.endsWith(SCRIPTS[name].replace(/^scratch/, "")) && !f.includes(".min.")
  );
  if (renamed) fs.copyFileSync(path.join(out, renamed), want);
  return mode;
};

export const ensureWebBundle = async (recipe: WebRecipe): Promise<string> => {
  const dir = path.join(WEB_DIR, recipe.id);
  const specs = Object.fromEntries(
    await Promise.all(
      recipe.parts.map(async (p) => [p.dep, await specOf(p.dep)]),
    ),
  );
  const stamp = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify({ recipe, specs }))
    .digest("hex")
    .slice(0, 16);
  const manifest = path.join(dir, "manifest.json");
  if (
    fs.existsSync(manifest) &&
    JSON.parse(fs.readFileSync(manifest, "utf8")).recipe === stamp
  ) return dir;

  log(`building browser bundles for ${recipe.id} (first run only)`);
  fs.rmSync(dir, { recursive: true, force: true });
  const modes: Record<string, string> = {};
  for (const part of recipe.parts) {
    log(`${recipe.id}: ${part.name} (${part.dep})`);
    const out = path.join(dir, part.name);
    modes[part.name] = await buildPart(part, specs[part.dep], out);
    if (!fs.existsSync(path.join(out, SCRIPTS[part.name]))) {
      throw new Error(
        `${recipe.id}: ${part.name} build produced no ${SCRIPTS[part.name]}`,
      );
    }
  }
  fs.writeFileSync(
    manifest,
    JSON.stringify(
      {
        recipe: stamp,
        deps: specs,
        build_modes: modes,
        scripts: recipe.parts.map((p) => `${p.name}/${SCRIPTS[p.name]}`),
      },
      null,
      2,
    ),
  );
  return dir;
};
