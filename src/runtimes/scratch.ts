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
    // From when TurboWarp forked it, so the two start together.
    since: { performance: "2020-06-08", parity: "2020-06-08" },
    // Before 2024-09-05 Scratch's packages lived in their own repos; the monorepo's imported history has each as a
    // separate line with no commit holding them all, so a browser (parity) build cannot come from one checkout.
    // scratch-storage joined the monorepo on 2026-06-10 (24ffd86); its imported
    // history also touches packages/scratch-storage, so before then pin it from npm.
    parts: [
      { git: "scratchfoundation/scratch-vm", until: "2024-09-04", provides: { vm: "." } },
      { git: "scratchfoundation/scratch-render", until: "2024-09-04", provides: { render: "." } },
      { git: "scratchfoundation/scratch-svg-renderer", until: "2024-09-04", provides: { svg: "." } },
      {
        git: "scratchfoundation/scratch-editor",
        branch: "develop",
        since: "2024-09-05",
        until: "2026-06-09",
        provides: {
          vm: "packages/scratch-vm",
          render: "packages/scratch-render",
          svg: "packages/scratch-svg-renderer",
        },
        shared: ["packages/task-herder"],
      },
      { npm: "scratch-storage", until: "2026-06-09", provides: "storage" },
      {
        git: "scratchfoundation/scratch-editor",
        branch: "develop",
        since: "2026-06-10",
        provides: {
          vm: "packages/scratch-vm",
          render: "packages/scratch-render",
          svg: "packages/scratch-svg-renderer",
          storage: "packages/scratch-storage",
        },
        shared: ["packages/task-herder"],
        fallback: {
          storage: {
            git: "scratchfoundation/scratch-storage",
            branch: "develop",
          },
        },
      },
      { npm: "scratch-audio", provides: "audio" },
    ],
  },
});
