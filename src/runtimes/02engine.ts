import path from "node:path";
import { ROOT } from "../paths.ts";
import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const zeroTwoEngine = nodeVmRuntime(
  "02engine",
  "02engine",
  async () => {
    const { version, commit } = await gitPinnedVersion("02engine-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "02engine/scratch-vm" },
    };
  },
  {
    web: async () => {
      const recipe = forkStack("02engine", { storage: true });
      const config = path.join(
        ROOT,
        "node_modules",
        "turbowarp-render",
        "webpack.config.js",
      );
      return {
        ...recipe,
        parts: recipe.parts.map((
          p,
        ) => (p.name === "render" ? { ...p, config } : p)),
      };
    },
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      since: { performance: "2025-08-09", parity: "2025-08-09" },
      parts: [
        { git: "02engine/scratch-vm", provides: { vm: "." } },
        { git: "02engine/scratch-render", provides: { render: "." } },
        { git: "02engine/scratch-audio", provides: { audio: "." } },
        { git: "Deep-sea-lab/scratch-svg-renderer", provides: { svg: "." } },
        { npm: "@turbowarp/scratch-storage", provides: "storage" },
      ],
    },
  },
);
