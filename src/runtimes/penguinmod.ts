import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

export const penguinmod = nodeVmRuntime(
  "penguinmod",
  "PenguinMod",
  async () => {
    const { version, commit } = await gitPinnedVersion("penguinmod-vm");
    return {
      version,
      detail: { "vm-commit": commit, repo: "PenguinMod/PenguinMod-Vm" },
    };
  },
  {
    web: async () => forkStack("penguinmod"),
    history: {
      since: { performance: "2025-08-01", parity: "2026-10-26" },
      latestOnly: ["parity"],
      parts: [
        { git: "PenguinMod/PenguinMod-Vm", provides: { vm: "." } },
        { git: "PenguinMod/PenguinMod-Render", provides: { render: "." } },
        { git: "PenguinMod/PenguinMod-Storage", provides: { storage: "." } },
        { git: "PenguinMod/penguinmod-svg-renderer", provides: { svg: "." } },
        { git: "PenguinMod/PenguinMod-Audio", provides: { audio: "." } },
      ],
    },
  },
);
