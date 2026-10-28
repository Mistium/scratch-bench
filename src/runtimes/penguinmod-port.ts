import type { Variant } from "./types.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// penguinmod-port is the remake of PenguinMod on newer TurboWarp. It is reported as two more VM modes of PenguinMod
// rather than a runtime of its own; it has its own builds, so it is a runtime here.
const PORT_VARIANTS: Variant[] = [
  { id: "port", name: "port", default: false, env: { BENCH_COMPILER: "1" } },
  { id: "port-interpreter", name: "port (interpreter)", default: false, env: { BENCH_COMPILER: "0" } },
];

export const penguinmodPort = {
  ...nodeVmRuntime(
    "penguinmod-port",
    "PenguinMod (port)",
    async () => {
      const { version, commit } = await gitPinnedVersion("penguinmod-port-vm");
      return { version, detail: { "vm-commit": commit, repo: "penguinmod-port/scratch-vm" } };
    },
    {
      web: async () => forkStack("penguinmod-port", { svg: true }),
      variants: PORT_VARIANTS,
      history: {
        variants: PORT_VARIANTS,
        fallback: 5,
        // When the penguinmod-port organisation's repos were created.
        since: { performance: "2025-11-16", parity: "2025-11-16" },
        parts: [
          { git: "penguinmod-port/scratch-vm", branch: "develop", provides: { vm: "." } },
          { git: "penguinmod-port/scratch-render", branch: "develop", provides: { render: "." } },
          { git: "penguinmod-port/scratch-storage", branch: "develop", provides: { storage: "." } },
          { git: "penguinmod-port/scratch-svg-renderer", branch: "develop", provides: { svg: "." } },
          { git: "penguinmod-port/scratch-audio", branch: "develop", provides: { audio: "." } },
        ],
      },
    },
  ),
  resultsAs: { id: "penguinmod", name: "PenguinMod" },
};
