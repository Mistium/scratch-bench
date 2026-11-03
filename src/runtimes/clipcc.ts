import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// ClipCC (Clipteam): a scratch-vm fork popular in China. No compiler, so it has only the interpreter mode. Its VM has
// not changed since April 2024, so there is no history to backfill.
export const clipcc = nodeVmRuntime(
  "clipcc",
  "ClipCC",
  async () => {
    const { version, commit } = await gitPinnedVersion("clipcc-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "Clipteam/clipcc-vm" },
    };
  },
  { web: async () => forkStack("clipcc", { svg: true, storage: true }) },
);
