import { COMPILER_VARIANTS } from "../variants.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const penguinmod = nodeVmRuntime(
  "penguinmod",
  "PenguinMod",
  async () => {
    const { version, commit } = await gitPinnedVersion("penguinmod-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "PenguinMod/PenguinMod-Vm" },
    };
  },
  {
    web: async () => forkStack("penguinmod"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      fallback: 5,
      // A fork's git history includes the code it was forked from, so start when the fork's repo was created.
      since: { performance: "2022-10-18", parity: "2022-10-18" },
      parts: [
        { git: "PenguinMod/PenguinMod-Vm", provides: { vm: "." } },
        { git: "PenguinMod/PenguinMod-Render", provides: { render: "." } },
        { git: "PenguinMod/PenguinMod-Storage", provides: { storage: "." } },
        { git: "PenguinMod/penguinmod-svg-renderer", provides: { svg: "." } },
        { git: "PenguinMod/PenguinMod-Audio", provides: { audio: "." } },
      ],
    },
  },
);
