import os from "node:os";
import { ROOT } from "./paths.ts";

const run = (cmd: string[], cwd?: string): string | null => {
  try {
    const p = Bun.spawnSync(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  } catch {
    return null;
  }
};

export const hostInfo = () => {
  return {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    memory_gb: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: run(["node", "--version"]),
    bun: Bun.version,
    chromium: run([process.env.CHROME ?? "chromium", "--version"]),
  };
};

export const repoInfo = () => {
  const sha = run(["git", "rev-parse", "HEAD"], ROOT);
  const dirty =
    (run(["git", "status", "--porcelain", "--untracked-files=no"], ROOT) ??
      "") !== "";
  return {
    sha,
    dirty,
    parity_sha: run(["git", "rev-parse", "HEAD"], `${ROOT}/parity`),
  };
};
