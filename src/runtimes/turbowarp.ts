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
  {
    web: async () => forkStack("turbowarp"),
    history: {
      since: { performance: "2025-08-01", parity: "2025-08-01" },
      parts: [
        { git: "TurboWarp/scratch-vm", provides: { vm: "." } },
        { git: "TurboWarp/scratch-render", provides: { render: "." } },
        { git: "TurboWarp/scratch-svg-renderer", provides: { svg: "." } },
        { git: "TurboWarp/scratch-storage", provides: { storage: "." } },
        { git: "TurboWarp/scratch-audio", provides: { audio: "." } },
      ],
    },
  },
);
