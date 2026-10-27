import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

for (const level of ["log", "warn"]) {
  const original = console[level];
  console[level] = (...a) => {
    if (!a.some((x) => String(x).includes("No storage module present"))) {
      original(...a);
    }
  };
}

const readFileSync = fs.readFileSync;
fs.readFileSync = (p, ...rest) => {
  if (
    typeof p === "string" && p.endsWith("default-stylesheet.css") &&
    !fs.existsSync(p)
  ) return "";
  return readFileSync(p, ...rest);
};

process.stdout.on("error", () => process.exit(0));

const VMS = {
  scratch: { pkg: "@scratch/scratch-vm", compiler: false },
  turbowarp: { pkg: "turbowarp-vm", compiler: true },
  mistwarp: { pkg: "mistwarp-vm", compiler: true },
  nitrobolt: { pkg: "nitrobolt-vm", compiler: true },
  penguinmod: { pkg: "penguinmod-vm", compiler: true },
};

const [vmName, file] = process.argv.slice(2);
if (!(vmName in VMS) || !file) {
  console.error(
    `usage: node node-vm.mjs <${Object.keys(VMS).join("|")}> <project.sb3>`,
  );
  process.exit(2);
}

if (vmName === "penguinmod") {
  const { DOMParser } = require("linkedom");
  globalThis.DOMParser = DOMParser;
  globalThis.location = new URL("http://localhost/");
  globalThis.window = globalThis;
}

const VirtualMachine = require(process.env.BENCH_VM_DIR ?? VMS[vmName].pkg);
fs.readFileSync = readFileSync;

const vm = new VirtualMachine();
if (VMS[vmName].compiler && typeof vm.setCompilerOptions === "function") {
  vm.setCompilerOptions({
    enabled: process.env.BENCH_COMPILER !== "0",
    warpTimer: false,
  });
}

vm.loadProject(fs.readFileSync(file)).then(() => {
  const stage = vm.runtime.getTargetForStage();
  const list = stage.lookupVariableByNameAndType("output", "list");
  if (!list) throw new Error('project has no list named "output"');

  let printed = 0;
  let idleSince = null;
  const flush = () => {
    while (printed < list.value.length) {
      process.stdout.write(`[PROJECT] ${list.value[printed++]}\n`);
    }
  };
  setInterval(() => {
    flush();
    if (vm.runtime.threads.length > 0) {
      idleSince = null;
    } else {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 2000) {
        vm.quit();
        process.exit(0);
      }
    }
  }, 20);

  vm.start();
  vm.greenFlag();
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
