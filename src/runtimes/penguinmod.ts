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
  { web: async () => forkStack("penguinmod") },
);
