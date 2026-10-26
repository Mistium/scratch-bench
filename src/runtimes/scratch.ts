import { nodeVmRuntime, packageVersion } from "./node-vm.ts";

export const scratch = nodeVmRuntime("scratch", "Scratch", async () => ({
  version: await packageVersion("@scratch/scratch-vm"),
  detail: {
    "scratch-render": await packageVersion("@scratch/scratch-render"),
    "scratch-svg-renderer": await packageVersion(
      "@scratch/scratch-svg-renderer",
    ),
  },
}));
