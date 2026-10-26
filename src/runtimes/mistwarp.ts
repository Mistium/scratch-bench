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
  {
    web: async () => forkStack("mistwarp", { svg: true, storage: true }),
    history: {
      since: { performance: "2025-08-01", parity: "2025-08-01" },
      parts: [
        { git: "MistWarp/scratch-vm", provides: { vm: "." } },
        { git: "MistWarp/scratch-render", provides: { render: "." } },
        { git: "MistWarp/scratch-audio", provides: { audio: "." } },
        { npm: "@turbowarp/scratch-storage", provides: "storage" },
        { npm: "@turbowarp/scratch-svg-renderer", provides: "svg" },
      ],
    },
  },
);
