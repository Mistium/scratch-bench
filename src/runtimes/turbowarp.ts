import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const turbowarp = nodeVmRuntime(
  "turbowarp",
  "TurboWarp",
  async () => {
    const { version, commit } = await gitPinnedVersion("turbowarp-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "TurboWarp/scratch-vm" },
    };
  },
  {
    web: async () => forkStack("turbowarp"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      // TurboWarp forked scratch-vm on 2020-06-08 ("What if we compiled the blocks?").
      since: { performance: "2020-06-08", parity: "2020-06-08" },
      parts: [
        { git: "TurboWarp/scratch-vm", provides: { vm: "." } },
        { git: "TurboWarp/scratch-render", provides: { render: "." } },
        { git: "TurboWarp/scratch-svg-renderer", provides: { svg: "." } },
        { git: "TurboWarp/scratch-storage", provides: { storage: "." } },
        { git: "TurboWarp/scratch-audio", provides: { audio: "." } },
      ],
    },
  },
);
