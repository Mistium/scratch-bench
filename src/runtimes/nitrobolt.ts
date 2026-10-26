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
  {
    web: async () => forkStack("nitrobolt", { svg: true, storage: true }),
    history: {
      since: { performance: "2025-08-01", parity: "2025-08-01" },
      parts: [
        { git: "Nitro-Bolt/scratch-vm", provides: { vm: "." } },
        { git: "Nitro-Bolt/scratch-render", provides: { render: "." } },
        { git: "TurboWarp/scratch-audio", provides: { audio: "." } },
        { npm: "@nitro-bolt/scratch-storage", provides: "storage" },
        { npm: "@turbowarp/scratch-svg-renderer", provides: "svg" },
      ],
    },
  },
);
