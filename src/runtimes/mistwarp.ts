import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const mistwarp = nodeVmRuntime(
  "mistwarp",
  "MistWarp",
  async () => {
    const { version, commit } = await gitPinnedVersion("mistwarp-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "MistWarp/scratch-vm" },
    };
  },
  { web: async () => forkStack("mistwarp", { svg: true, storage: true }) },
);
