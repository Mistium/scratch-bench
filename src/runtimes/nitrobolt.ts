import { COMPILER_VARIANTS } from "../variants.ts";
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
    variants: COMPILER_VARIANTS,
    history: {
      variants: COMPILER_VARIANTS,
      fallback: 5,
      // A fork's git history includes the code it was forked from, so start when the fork's repo was created.
      since: { performance: "2024-02-05", parity: "2024-02-05" },
      parts: [
        { git: "Nitro-Bolt/scratch-vm", provides: { vm: "." } },
        { git: "Nitro-Bolt/scratch-render", provides: { render: "." } },
        { git: "TurboWarp/scratch-audio", provides: { audio: "." } },
        // 1.0.2 (published late on 2026-08-17, replaced 2026-10-14) shipped a browser build that throws on load; use TurboWarp's meanwhile.
        { npm: "@nitro-bolt/scratch-storage", until: "2026-08-16", provides: "storage" },
        { npm: "@turbowarp/scratch-storage", since: "2026-08-17", until: "2026-10-13", provides: "storage" },
        { npm: "@nitro-bolt/scratch-storage", since: "2026-10-14", provides: "storage" },
        { npm: "@turbowarp/scratch-svg-renderer", provides: "svg" },
      ],
    },
  },
);
