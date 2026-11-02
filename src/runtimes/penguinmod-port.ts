import type { Variant } from "./types.ts";
import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// penguinmod-port is the remake of PenguinMod on newer TurboWarp, shown as a mod of its own. The mode ids are from when
// it was reported as two extra modes of PenguinMod; they stay, as the backfill's saved state is keyed on them.
const PORT_VARIANTS: Variant[] = [
  { id: "port", name: "compiler", default: true, env: { BENCH_COMPILER: "1" } },
  { id: "port-interpreter", name: "interpreter", default: false, env: { BENCH_COMPILER: "0" } },
];

export const penguinmodPort = nodeVmRuntime(
  "penguinmod-port",
  "PenguinMod (port)",
  async () => {
    const { version, commit } = await gitPinnedVersion("penguinmod-port-vm");
    return { version, detail: { "vm-commit": commit, repo: "penguinmod-port/scratch-vm" } };
  },
  {
    web: async () => forkStack("penguinmod-port"), // its svg-renderer installs as source, with no dist/
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
);
