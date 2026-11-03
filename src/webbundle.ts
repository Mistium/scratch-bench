import fs from "node:fs";
import path from "node:path";
import { ROOT, RUNTIME_DIR } from "./paths.ts";

export type WebPart = {
  name: "vm" | "render" | "svg" | "storage" | "audio";
  dep: string;
  how: "webpack" | "esbuild" | "dist";
  /** A webpack config to build with when the package has none of its own (02engine's renderer). */
  config?: string;
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
    throw Object.assign(
      new Error(`${cmd.join(" ")} failed in ${cwd}:\n${tail}`),
      { output: `${err}\n${out}` },
    );
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
  if (fs.existsSync(path.join(dir, "yarn.lock"))) {
    fs.rmSync(path.join(dir, "package-lock.json"), { force: true });
  }
  rewriteLockfiles(dir, PRIVATE_REGISTRY, "https://registry.npmjs.org");
  try {
    await run(["bun", "install", "--ignore-scripts"], dir);
  } catch (e) {
    const message = (e as Error).message;
    const pkgFile = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    const missing = message.match(/(\S+)@\S+ failed to resolve/)?.[1];
    if (/Integrity check failed/.test(message)) pinGitDeps(dir);
    else if (/failed to migrate lockfile/.test(message)) {
      rewriteLockfiles(
        dir,
        "git+ssh://git@github.com/",
        "git+https://github.com/",
      );
    } else if (missing && pkg.devDependencies?.[missing]) {
      delete pkg.devDependencies[missing];
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    } else throw e;
    await run(["bun", "install", "--ignore-scripts"], dir);
  }
  fs.writeFileSync(path.join(dir, "node_modules/.bench-installed"), "");
};

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
  const rel = "node_modules/webpack-cli/bin/cli.js";
  let d = dir;
  while (!fs.existsSync(path.join(d, rel)) && path.dirname(d) !== d) {
    d = path.dirname(d);
  }
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
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await run(c, dir, { ...legacy, NODE_ENV });
          return NODE_ENV;
        } catch (e) {
          error ??= e;
          if (
            !(await downlevelUnparsable(
              dir,
              (e as { output?: string }).output ?? "",
            ))
          ) break;
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
const downlevelUnparsable = async (
  dir: string,
  output: string,
): Promise<boolean> => {
  const packages = new Set<string>();
  for (
    const m of output.matchAll(
      /ERROR in (\.\/node_modules\/(?:@[^/\s]+\/)?[^/\s]+)[^\n]*\n\s*Module parse failed/g,
    )
  ) {
    packages.add(path.join(dir, m[1]!));
  }
  const { transformSync } = await import("esbuild");
  let rewrote = false;
  for (
    const m of output.matchAll(
      /(?:ERROR in |\[\d+\] )(\.\/(?!node_modules\/)[^\s]+\.js)[^\n]*(?:\[failed\]|\n\s*Module (?:parse|build) failed)/g,
    )
  ) {
    const file = path.join(dir, m[1]!);
    if (!fs.existsSync(file) || downlevelled.has(file)) continue;
    downlevelled.add(file);
    try {
      fs.writeFileSync(
        file,
        transformSync(fs.readFileSync(file, "utf8"), {
          loader: "js",
          target: "es2019",
        }).code,
      );
      rewrote = true;
    } catch {}
  }
  for (const pkg of packages) {
    if (
      !fs.existsSync(pkg) ||
      fs.existsSync(path.join(pkg, ".bench-downlevelled"))
    ) continue;
    for (const file of fs.readdirSync(pkg, { recursive: true }) as string[]) {
      if (
        !/\.(c|m)?js$/.test(file) ||
        file.split(path.sep).includes("node_modules")
      ) continue;
      const full = path.join(pkg, file);
      try {
        const code = transformSync(fs.readFileSync(full, "utf8"), {
          loader: "js",
          target: "es2019",
        }).code;
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
  if (part.config && !fs.existsSync(path.join(dir, "webpack.config.js"))) {
    fs.copyFileSync(part.config, path.join(dir, "webpack.config.js"));
  }
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
  const want = path.join(out, SCRIPTS[name]);
  const renamed = fs.existsSync(want)
    ? undefined
    : fs.readdirSync(out).find((f) =>
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
