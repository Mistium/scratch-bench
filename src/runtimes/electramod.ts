import { COMPILER_VARIANTS } from "../variants.ts";
import {
  gitPinnedVersion,
  nodeVmRuntime,
  penguinForkStack,
} from "./node-vm.ts";

export const electramod = nodeVmRuntime(
  "electramod",
  "ElectraMod",
  async () => {
    const { version, commit } = await gitPinnedVersion("electramod-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "ElectraMod/scratch-vm" },
    };
  },
  {
    web: async () => penguinForkStack("electramod"),
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      since: { performance: "2024-04-01", parity: "2024-04-01" },
      parts: [
        { git: "ElectraMod/scratch-vm", provides: { vm: "." } },
        { git: "PenguinMod/PenguinMod-Render", provides: { render: "." } },
        { git: "PenguinMod/PenguinMod-Storage", provides: { storage: "." } },
        { git: "PenguinMod/penguinmod-svg-renderer", provides: { svg: "." } },
        { git: "PenguinMod/PenguinMod-Audio", provides: { audio: "." } },
      ],
    },
  },
);
