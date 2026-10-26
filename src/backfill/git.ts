import fs from "node:fs";
import path from "node:path";
import { run } from "../webbundle.ts";

export const checkout = async (
  repo: string,
  commit: string,
  dest: string,
  sparse: string[] = [],
): Promise<void> => {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  await run(["git", "init", "-q"], dest);
  await run(
    ["git", "remote", "add", "origin", `https://github.com/${repo}`],
    dest,
  );
  if (sparse.length) {
    await run(["git", "sparse-checkout", "init", "--cone"], dest);
    await run(["git", "sparse-checkout", "set", ...sparse], dest);
  }
  await run([
    "git",
    "fetch",
    "-q",
    "--depth",
    "1",
    "--filter=blob:none",
    "origin",
    commit,
  ], dest);
  await run(["git", "checkout", "-q", "FETCH_HEAD"], dest);
};

export const sparseDirs = (
  dirs: string[],
): string[] => (dirs.includes(".") ? [] : [...new Set(dirs)]);

export const dirSize = (dir: string): number => {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
};
