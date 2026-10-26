import path from "node:path";
import { ADAPTERS, ROOT } from "../paths.ts";
import { ensureWebBundle, type WebPart, type WebRecipe } from "../webbundle.ts";
import type { Runtime } from "./types.ts";

export type NodeVmId =
  | "scratch"
  | "turbowarp"
  | "mistwarp"
  | "nitrobolt"
  | "penguinmod";

export const nodeVmRuntime = (
  id: NodeVmId,
  name: string,
  describe: () => Promise<{ version: string; detail?: Record<string, string> }>,
  { gui = true, web }: { gui?: boolean; web?: () => Promise<WebRecipe> } = {},
): Runtime => {
  return {
    id,
    name,
    kind: "node",
    setup: async (opts) => {
      const info = await describe();
      if (web && opts.gui) await ensureWebBundle(await web());
      return info;
    },
    headless: {
      command: (sb3) => ({
        cmd: ["node", path.join(ADAPTERS, "node-vm.mjs"), id, sb3],
        cwd: ROOT,
      }),
    },
    gui: gui
      ? {
        command: (sb3) => ({
          cmd: ["node", path.join(ADAPTERS, "chromium-vm.mjs"), id, sb3],
          cwd: ROOT,
        }),
      }
      : undefined,
  };
};

export const packageVersion = async (pkg: string): Promise<string> => {
  const json = await Bun.file(
    path.join(ROOT, "node_modules", pkg, "package.json"),
  ).json();
  return json.version as string;
};

export const gitPinnedVersion = async (dep: string) => {
  const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
  const commit = String(pkg.dependencies[dep]).split("#")[1] ?? "unknown";
  return {
    version: `${await packageVersion(dep)}+${commit.slice(0, 7)}`,
    commit,
  };
};

export const forkStack = (
  id: string,
  prebuilt: { svg?: boolean; storage?: boolean } = {},
): WebRecipe => ({
  id,
  parts: [
    { name: "vm", dep: `${id}-vm`, how: "webpack" },
    { name: "render", dep: `${id}-render`, how: "webpack" },
    {
      name: "svg",
      dep: `${id}-svg-renderer`,
      how: prebuilt.svg ? "dist" : "webpack",
    },
    {
      name: "storage",
      dep: `${id}-storage`,
      how: prebuilt.storage ? "dist" : "webpack",
    },
    { name: "audio", dep: `${id}-audio`, how: "esbuild" },
  ] satisfies WebPart[],
});
