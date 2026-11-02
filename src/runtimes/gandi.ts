import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// Gandi IDE (CoCrea): its scratch-vm branched from Scratch on 2020-08-31 and has merged TurboWarp's compiler since.
export const gandi = nodeVmRuntime(
  "gandi",
  "Gandi IDE",
  async () => {
    const { version, commit } = await gitPinnedVersion("gandi-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "Gandi-IDE/scratch-vm" },
    };
  },
  {
    web: async () => forkStack("gandi", { svg: true }),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      since: { performance: "2025-08-01", parity: "2025-08-01" },
      parts: [
        { git: "Gandi-IDE/scratch-vm", provides: { vm: "." } },
        { git: "Gandi-IDE/scratch-render", provides: { render: "." } },
        { git: "Gandi-IDE/scratch-audio", provides: { audio: "." } },
        { git: "Gandi-IDE/scratch-storage", provides: { storage: "." } },
        { npm: "@turbowarp/scratch-svg-renderer", provides: "svg" },
      ],
    },
  },
);
