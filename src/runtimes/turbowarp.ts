import path from "node:path";
import { ROOT } from "../paths.ts";
import { nodeVmRuntime, packageVersion } from "./node-vm.ts";

export const turbowarp = nodeVmRuntime("turbowarp", "TurboWarp", async () => {
  const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
  const pinned = String(pkg.dependencies["turbowarp-vm"]).split("#")[1] ??
    "unknown";
  return {
    version: `${await packageVersion("turbowarp-vm")}+${pinned.slice(0, 7)}`,
    detail: {
      "vm-commit": pinned,
      scaffolding: await packageVersion("@turbowarp/scaffolding"),
    },
  };
});
