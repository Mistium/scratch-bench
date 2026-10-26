import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./paths.ts";

const FILE = ".bench.lock";

interface Lock {
  pid: number;
  startedAt: string;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const read = (file: string): Lock | null => {
  try {
    const lock = JSON.parse(fs.readFileSync(file, "utf8")) as Lock;
    return typeof lock.pid === "number" ? lock : null;
  } catch {
    return null;
  }
};

export const acquireLock = (dir = RESULTS_DIR): (() => void) | null => {
  const file = path.join(dir, FILE);
  const held = read(file);
  if (held && alive(held.pid)) {
    return held.pid === process.ppid || held.pid === process.pid
      ? () => {}
      : null;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      { pid: process.pid, startedAt: new Date().toISOString() } satisfies Lock,
    ),
  );
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (read(file)?.pid === process.pid) fs.rmSync(file, { force: true });
  };
  process.on("exit", release);
  return release;
};
