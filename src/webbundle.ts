import { transformSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { ROOT, RUNTIME_DIR } from "./paths.ts";

export type WebPart = {
  name: "vm" | "render" | "svg" | "storage" | "audio";
  dep: string;
  how: "webpack" | "esbuild" | "dist";
  /** Lower syntax webpack 4 cannot parse and build only the browser bundle (PenguinMod (port), see webpack). */
  modern?: boolean;
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

export const run = async (
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
) => {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env } as Record<string, string>,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    const noise =
      /browserslist|update-browserslist-db|update-db#readme|DeprecationWarning|trace-deprecation/i;
    const lines = `${err}\n${out}`.split("\n").filter((l) =>
      l.trim() && !noise.test(l)
    );
    const first = lines.findIndex((l) => /ERROR in|Error:/.test(l));
    const tail = (first >= 0 ? lines.slice(first) : lines.slice(-8)).slice(0, 8)
      .join("\n");
    throw new Error(`${cmd.join(" ")} failed in ${cwd}:\n${tail}`);
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

const pinGitDeps = (dir: string) => {
  const lockFile = path.join(dir, "package-lock.json");
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(lockFile)) return;
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries<string>(pkg[field] ?? {})) {
      if (!/^(github:|git\+|git:|[\w.-]+\/[\w.-]+(#|$))/.test(spec)) continue;
      const entry = lock.packages?.[`node_modules/${name}`] ??
        lock.dependencies?.[name];
      const m = String(entry?.resolved ?? entry?.version ?? "").match(
        /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?#([0-9a-f]{40})$/,
      );
      if (m) pkg[field][name] = `github:${m[1]}#${m[2]}`;
    }
  }
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  fs.rmSync(lockFile);
};

// Gandi resolves every package through its own npm mirror, unreachable from elsewhere; the tarball paths are npm's.
const PRIVATE_REGISTRY = /https?:\/\/npm\.xiguacity\.cn/g;

const rewriteLockfiles = (dir: string, from: RegExp | string, to: string) => {
  for (const name of ["yarn.lock", "package-lock.json"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const fixed = text.replaceAll(from, to);
    if (fixed !== text) fs.writeFileSync(file, fixed);
  }
};

export const install = async (dir: string) => {
  if (fs.existsSync(path.join(dir, "node_modules/.bench-installed"))) return;
  // A repo with a yarn.lock uses yarn, so a package-lock.json beside it is stale (Gandi's scratch-render has one).
  if (fs.existsSync(path.join(dir, "yarn.lock"))) fs.rmSync(path.join(dir, "package-lock.json"), { force: true });
  rewriteLockfiles(dir, PRIVATE_REGISTRY, "https://registry.npmjs.org");
  try {
    await run(["bun", "install", "--ignore-scripts"], dir);
  } catch (e) {
    const message = (e as Error).message;
    const pkgFile = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    const missing = message.match(/(\S+)@\S+ failed to resolve/)?.[1];
    if (/Integrity check failed/.test(message)) pinGitDeps(dir);
    // SSH git URLs need a key; the same repos over HTTPS do not (PenguinMod (port)'s lockfile has them).
    else if (/failed to migrate lockfile/.test(message)) {
      rewriteLockfiles(dir, "git+ssh://git@github.com/", "git+https://github.com/");
    } // A devDependency the lockfile lacks (ClipCC's scratch-render lists clipcc-vm, used only by its playground).
    else if (missing && pkg.devDependencies?.[missing]) {
      delete pkg.devDependencies[missing];
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    } else throw e;
    await run(["bun", "install", "--ignore-scripts"], dir);
  }
  fs.writeFileSync(path.join(dir, "node_modules/.bench-installed"), "");
};

const TRANSPILED = ["rotur-sdk"];
const WRAPPER = "bench.webpack.config.cjs";
const wrapperConfig = `const load = require("./webpack.config.js");
const rule = {
  test: /\\.m?js$/,
  type: "javascript/auto",
  loader: "babel-loader",
  include: /[\\\\/]node_modules[\\\\/](${TRANSPILED.join("|")})[\\\\/]/,
  options: { babelrc: false, configFile: false, presets: [["@babel/preset-env"]] },
};
const patch = (c) => ({ ...c, module: { ...c.module, rules: [rule, ...(c.module?.rules ?? [])] } });
module.exports = (...args) => {
  const c = typeof load === "function" ? load(...args) : load;
  return Array.isArray(c) ? c.map(patch) : patch(c);
};
`;

// Only the configs that write the browser bundle (dist/web): PenguinMod (port)'s also has playground configs that copy
// other packages' dist/ folders, which are not built here.
const WEB_ONLY = "bench.web.config.cjs";
const webOnlyConfig = `const load = require("./webpack.config.js");
const web = typeof load === "function" ? [] : [].concat(load).filter((c) => /dist[\\\\/]web$/.test(String(c.output?.path ?? "")));
module.exports = web.length ? web : load;
`;

const patchBlocksPath = (dir: string) => {
  const file = path.join(dir, "webpack.config.js");
  const text = fs.readFileSync(file, "utf8");
  const fixed = text.replaceAll(
    "scratch-blocks/dist/vertical.js",
    "scratch-blocks/shim/vertical.js",
  );
  if (fixed === text) return false;
  fs.writeFileSync(file, fixed);
  return true;
};

export const webpack = async (
  dir: string,
  { modern = false }: { modern?: boolean } = {},
): Promise<"production" | "development" | "patched"> => {
  const cmd = ["node", "node_modules/webpack-cli/bin/cli.js", "--bail"];
  const legacy = { NODE_OPTIONS: "--openssl-legacy-provider" };
  const attempt = async (extra: string[]) => {
    try {
      await run([...cmd, ...extra], dir, { ...legacy, NODE_ENV: "production" });
      return "production" as const;
    } catch {
      await run([...cmd, ...extra], dir, {
        ...legacy,
        NODE_ENV: "development",
      });
      return "development" as const;
    }
  };
  const rewritten = new Set<string>();
  const fixups: Array<[RegExp, (message: string) => string[] | null]> = [
    // `modern` only: syntax webpack 4 or a package's own Babel cannot parse (PenguinMod (port)'s scratch-render uses
    // `??`): lower the file that failed to ES2019 with esbuild.
    ...(modern ? [[/Unexpected token/, (message: string) => {
      const file = message.match(/ERROR in \.\/(\S+\.js)/)?.[1];
      if (!file || rewritten.has(file) || !fs.existsSync(path.join(dir, file))) return null;
      rewritten.add(file);
      const full = path.join(dir, file);
      fs.writeFileSync(full, transformSync(fs.readFileSync(full, "utf8"), { loader: "js", target: "es2019" }).code);
      return [];
    }] as [RegExp, (message: string) => string[] | null]] : []),
    [
      /Cannot find module 'scratch-blocks\/dist\/vertical\.js'/,
      () => patchBlocksPath(dir) ? [] : null,
    ],
    [/Module parse failed/, () => {
      fs.writeFileSync(path.join(dir, WRAPPER), wrapperConfig);
      return ["--config", WRAPPER];
    }],
  ];
  if (modern) fs.writeFileSync(path.join(dir, WEB_ONLY), webOnlyConfig);
  let extra: string[] = modern ? ["--config", WEB_ONLY] : [];
  let patched = false;
  for (let tries = 0; ; tries++) {
    try {
      const mode = await attempt(extra);
      return patched ? "patched" : mode;
    } catch (e) {
      const fix = fixups.find(([re]) => re.test((e as Error).message));
      // Each file lowered for `modern` needs its own round, so those rounds do not count against the budget.
      const next = fix && tries < fixups.length + rewritten.size ? fix[1]((e as Error).message) : null;
      if (!next) throw e;
      if (next.length) extra = next;
      patched = true;
    }
  }
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
  return buildDirPart(part.name, dir, out, part.how, { modern: part.modern });
};

export const buildDirPart = async (
  name: WebPart["name"],
  dir: string,
  out: string,
  how: "webpack" | "esbuild",
  { installed = false, modern = false }: { installed?: boolean; modern?: boolean } = {},
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
    : await webpack(dir, { modern });
  // ClipCC names its VM bundle clipcc-vm.js: copy it to the usual name.
  const want = path.join(dist, SCRIPTS[name]);
  const clipcc = path.join(dist, SCRIPTS[name].replace(/^scratch/, "clipcc"));
  if (!fs.existsSync(want) && fs.existsSync(clipcc)) fs.copyFileSync(clipcc, want);
  fs.cpSync(dist, out, { recursive: true });
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
