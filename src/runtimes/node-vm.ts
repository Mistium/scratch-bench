import path from "node:path";
import { ADAPTERS, ROOT } from "../paths.ts";
import type { Runtime } from "./types.ts";

export const nodeVmRuntime = (
  id: "scratch" | "turbowarp",
  name: string,
  describe: () => Promise<{ version: string; detail?: Record<string, string> }>,
): Runtime => {
  return {
    id,
    name,
    kind: "node",
    setup: describe,
    headless: {
      command: (sb3) => ({
        cmd: ["node", path.join(ADAPTERS, "node-vm.mjs"), id, sb3],
        cwd: ROOT,
      }),
    },
    gui: {
      command: (sb3) => ({
        cmd: ["node", path.join(ADAPTERS, "chromium-vm.mjs"), id, sb3],
        cwd: ROOT,
      }),
    },
  };
};

export const packageVersion = async (pkg: string): Promise<string> => {
  const json = await Bun.file(
    path.join(ROOT, "node_modules", pkg, "package.json"),
  ).json();
  return json.version as string;
};
