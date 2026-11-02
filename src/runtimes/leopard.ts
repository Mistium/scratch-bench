import fs from "node:fs";
import path from "node:path";
import { endOfDay } from "../backfill/schedule.ts";
import { ADAPTERS, CACHE, ROOT } from "../paths.ts";
import { run, timesOf } from "../webbundle.ts";
import { packageVersion } from "./node-vm.ts";
import type { Command, Pin, Runtime } from "./types.ts";

// Leopard: sb-edit converts the project to JavaScript, which Leopard runs in a browser (no scratch-vm).
const HISTORY = path.join(CACHE, "backfill", "leopard");

// `dir` holds a node_modules with the sb-edit and leopard to use (the repo's own when omitted).
const command = (sb3: string, dir?: string): Command => ({
  cmd: ["node", path.join(ADAPTERS, "leopard.mjs"), sb3],
  cwd: ROOT,
  env: dir ? { ...(process.env as Record<string, string>), LEOPARD_DIR: dir } : undefined,
});

// The newest stable release of `pkg` published by the end of `date` that passes `ok`.
const releaseOn = async (pkg: string, date: string, ok = (_v: string) => true) => {
  const times = await timesOf(pkg);
  if (!times) throw new Error(`could not read ${pkg}'s releases from npm`);
  const versions = Object.entries<string>(times)
    .filter(([v, at]) => at <= endOfDay(date) && !v.includes("-") && ok(v))
    .map(([v]) => v)
    .sort(Bun.semver.order);
  return versions.at(-1);
};

export const leopard: Runtime = {
  id: "leopard",
  name: "Leopard",
  kind: "node",
  async setup() {
    const [lib, conv] = await Promise.all([packageVersion("leopard"), packageVersion("sb-edit")]);
    return { version: `${lib}+sb-edit.${conv}`, detail: { leopard: lib, "sb-edit": conv } };
  },
  headless: { command: (sb3) => command(sb3) },
  gui: { command: (sb3) => command(sb3) },
  history: {
    // Leopard's first release, the day sb-edit 0.13.0 added its converter.
    since: { performance: "2020-07-01", parity: "2020-07-01" },
    custom: {
      async resolve(date): Promise<Pin | null> {
        const lib = await releaseOn("leopard", date);
        // sb-edit 1.0.0 (January 2020) was a stray release from before the converter existed.
        const conv = await releaseOn("sb-edit", date, (v) => Bun.semver.satisfies(v, ">=0.13.0 <1"));
        if (!lib || !conv) return null;
        return { parts: [], custom: { version: `${lib}+sb-edit.${conv}`, leopard: lib, sbEdit: conv } };
      },
      async build(pin) {
        const { leopard: lib, sbEdit: conv } = pin.custom!;
        const dir = path.join(HISTORY, `${lib}_${conv}`);
        if (!fs.existsSync(path.join(dir, "node_modules", "sb-edit"))) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ private: true, dependencies: { leopard: lib, "sb-edit": conv } }),
          );
          await run(["bun", "install", "--ignore-scripts"], dir);
        }
        return { command: (sb3) => command(sb3, dir) };
      },
    },
  },
};
