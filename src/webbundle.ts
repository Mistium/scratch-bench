import fs from "node:fs";
import path from "node:path";
import { ROOT, RUNTIME_DIR } from "./paths.ts";

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

export const install = async (dir: string) => {
  if (fs.existsSync(path.join(dir, "node_modules/.bench-installed"))) return;
  await run(["bun", "install", "--ignore-scripts"], dir);
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

export const webpack = async (
  dir: string,
): Promise<"production" | "development" | "transpiled"> => {
  const cmd = ["node", "node_modules/webpack-cli/bin/cli.js", "--bail"];
  const legacy = { NODE_OPTIONS: "--openssl-legacy-provider" };
  try {
    await run(cmd, dir, { ...legacy, NODE_ENV: "production" });
    return "production";
  } catch {
    try {
      await run(cmd, dir, { ...legacy, NODE_ENV: "development" });
      return "development";
    } catch (e) {
      if (!/Module parse failed/.test((e as Error).message)) throw e;
    }
  }
  fs.writeFileSync(path.join(dir, WRAPPER), wrapperConfig);
  await run([...cmd, "--config", WRAPPER], dir, {
    ...legacy,
    NODE_ENV: "production",
  });
  return "transpiled";
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
