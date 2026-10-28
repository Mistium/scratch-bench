import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const mistwarp = nodeVmRuntime(
  "mistwarp",
  "MistWarp",
  async () => {
    const { version, commit } = await gitPinnedVersion("mistwarp-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "MistWarp/scratch-vm" },
    };
  },
  {
    web: async () => forkStack("mistwarp", { svg: true, storage: true }),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      // A fork's git history includes the code it was forked from, so start when the fork's repo was created.
      since: { performance: "2024-09-22", parity: "2024-09-22" },
      // ponytail: many commits pin scratch-blocks#develop-builds at a commit with no dist/, so measure a nearby one that builds.
      fallback: 5,
      parts: [
        { git: "MistWarp/scratch-vm", provides: { vm: "." } },
        { git: "MistWarp/scratch-render", provides: { render: "." } },
        { git: "MistWarp/scratch-audio", provides: { audio: "." } },
        { npm: "@turbowarp/scratch-storage", provides: "storage" },
        { npm: "@turbowarp/scratch-svg-renderer", provides: "svg" },
      ],
    },
  },
);
