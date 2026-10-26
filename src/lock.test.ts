import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock } from "./lock.ts";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = () => path.join(dir, ".bench.lock");

test("takes a free lock and releases it", () => {
  const release = acquireLock(dir)!;
  expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(process.pid);
  release();
  expect(fs.existsSync(file())).toBe(false);
});

test("refuses while another live process holds it", () => {
  const other = Bun.spawn(["sleep", "30"]);
  try {
    fs.writeFileSync(
      file(),
      JSON.stringify({ pid: other.pid, startedAt: "x" }),
    );
    expect(acquireLock(dir)).toBeNull();
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(other.pid);
  } finally {
    other.kill();
  }
});

test("replaces a lock whose process is gone", () => {
  fs.writeFileSync(
    file(),
    JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: "x" }),
  );
  expect(acquireLock(dir)).not.toBeNull();
  expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(process.pid);
});

test("a lock held by the parent is respected as ours and left in place", () => {
  fs.writeFileSync(
    file(),
    JSON.stringify({ pid: process.ppid, startedAt: "x" }),
  );
  const release = acquireLock(dir)!;
  release();
  expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(process.ppid);
});

test("a corrupt lock file is replaced", () => {
  fs.writeFileSync(file(), "not json");
  expect(acquireLock(dir)).not.toBeNull();
});
