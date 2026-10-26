import { nodeVmRuntime, packageVersion } from "./node-vm.ts";

export const scratch = nodeVmRuntime("scratch", "Scratch", async () => ({
  version: await packageVersion("@scratch/scratch-vm"),
  detail: {
    "scratch-render": await packageVersion("@scratch/scratch-render"),
    "scratch-svg-renderer": await packageVersion(
      "@scratch/scratch-svg-renderer",
    ),
  },
}), {
  history: {
    since: { performance: "2025-08-01", parity: "2025-08-01" },
    parts: [
      {
        git: "scratchfoundation/scratch-editor",
        branch: "develop",
        provides: {
          vm: "packages/scratch-vm",
          render: "packages/scratch-render",
          svg: "packages/scratch-svg-renderer",
          storage: "packages/scratch-storage",
        },
        shared: ["packages/task-herder"],
      },
      { npm: "scratch-audio", provides: "audio" },
    ],
  },
});
