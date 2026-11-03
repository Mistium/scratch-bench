import { COMPILER_VARIANTS } from "../variants.ts";
import {
  gitPinnedVersion,
  nodeVmRuntime,
  penguinForkStack,
} from "./node-vm.ts";

export const snailide = nodeVmRuntime(
  "snailide",
  "Snail IDE",
  async () => {
    const { version, commit } = await gitPinnedVersion("snailide-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "snail-ide/Snail-IDE-Vm" },
    };
  },
  {
    web: async () => penguinForkStack("snailide"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      since: { performance: "2023-07-22", parity: "2023-07-22" },
      parts: [
        { git: "snail-ide/Snail-IDE-Vm", provides: { vm: "." } },
        { git: "PenguinMod/PenguinMod-Render", provides: { render: "." } },
        { git: "PenguinMod/PenguinMod-Storage", provides: { storage: "." } },
        { git: "PenguinMod/penguinmod-svg-renderer", provides: { svg: "." } },
        { git: "PenguinMod/PenguinMod-Audio", provides: { audio: "." } },
      ],
    },
  },
);
