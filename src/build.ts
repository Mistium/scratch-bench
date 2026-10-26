import fs from "node:fs";
import path from "node:path";
import { BUILD_DIR } from "./paths.ts";
import { type Suite, suiteSourceDir } from "./suites.ts";

export interface Built {
  sb3: string;
  hash: string;
}

const fractch = async (...args: string[]): Promise<string> => {
  const bin = Bun.which("fractch") ??
    path.join(process.env.HOME ?? "", ".cache/.bun/bin/fractch");
  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 120_000);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  if (code !== 0) {
    throw new Error(
      `fractch ${args.join(" ")} failed (${code}):\n${err || out}`,
    );
  }
  return out + err;
};

function* walk(dir: string): Generator<string> {
  for (
    const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  ) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const hashSource = (dir: string): string => {
  const h = new Bun.CryptoHasher("sha256");
  for (const file of walk(dir)) {
    h.update(path.relative(dir, file));
    h.update(fs.readFileSync(file));
  }
  return h.digest("hex").slice(0, 16);
};

export const buildSuite = async (suite: Suite): Promise<Built> => {
  const dir = suiteSourceDir(suite);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${suite.source} does not exist${
        suite.id === "parity" ? " (git submodule update --init)" : ""
      }`,
    );
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const sb3 = path.join(BUILD_DIR, `${suite.id}.sb3`);
  await fractch("check", dir);
  await fractch("to", sb3, "from", dir);
  return { sb3, hash: hashSource(dir) };
};
