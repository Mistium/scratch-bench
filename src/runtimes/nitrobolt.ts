import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const nitrobolt = nodeVmRuntime(
  "nitrobolt",
  "NitroBolt",
  async () => {
    const { version, commit } = await gitPinnedVersion("nitrobolt-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "Nitro-Bolt/scratch-vm" },
    };
  },
  { web: async () => forkStack("nitrobolt", { svg: true, storage: true }) },
);
