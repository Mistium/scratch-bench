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
  { web: async () => forkStack("turbowarp") },
);
