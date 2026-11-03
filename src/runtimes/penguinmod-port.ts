import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// penguinmod-port is the remake of PenguinMod on newer TurboWarp.
export const penguinmodPort = nodeVmRuntime(
  "penguinmod-port",
  "PenguinMod (port)",
  async () => {
    const { version, commit } = await gitPinnedVersion("penguinmod-port-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "penguinmod-port/scratch-vm" },
    };
  },
  {
    web: async () => forkStack("penguinmod-port"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      // When the penguinmod-port organisation's repos were created.
      since: { performance: "2025-11-16", parity: "2025-11-16" },
      parts: [
        { git: "penguinmod-port/scratch-vm", provides: { vm: "." } },
        { git: "penguinmod-port/scratch-render", provides: { render: "." } },
        { git: "penguinmod-port/scratch-storage", provides: { storage: "." } },
        { git: "penguinmod-port/scratch-svg-renderer", provides: { svg: "." } },
        { git: "penguinmod-port/scratch-audio", provides: { audio: "." } },
      ],
    },
  },
);
