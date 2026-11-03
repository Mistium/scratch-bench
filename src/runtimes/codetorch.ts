import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const codetorch = nodeVmRuntime(
  "codetorch",
  "CodeTorch",
  async () => {
    const { version, commit } = await gitPinnedVersion("codetorch-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "CodeTorchNET/scratch-vm" },
    };
  },
  {
    web: async () => forkStack("codetorch"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      since: { performance: "2024-11-28", parity: "2024-11-28" },
      parts: [
        { git: "CodeTorchNET/scratch-vm", provides: { vm: "." } },
        { git: "CodeTorchNET/scratch-render", provides: { render: "." } },
        { git: "CodeTorchNET/scratch-svg-renderer", provides: { svg: "." } },
        { git: "CodeTorchNET/scratch-storage", provides: { storage: "." } },
        { git: "CodeTorchNET/scratch-audio", provides: { audio: "." } },
      ],
    },
  },
);
