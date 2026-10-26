// usage: node node-vm.mjs <scratch|turbowarp> <project.sb3>
// Runs a project in a scratch-vm under Node the way a host normally does: vm.start() drives the runtime's own frame
// loop and the green flag is the only input. There is no renderer, audio or storage.
// Every item the project appends to its stage list "output" is printed as "[PROJECT] <item>", which is the protocol
// the orchestrator reads from every runtime. Exits by itself once no threads have run for 2 seconds.
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// scratch-vm warns about the project's blank placeholder costumes; drop only those warnings.
for (const level of ["log", "warn"]) {
  const original = console[level];
  console[level] = (...a) => {
    if (!a.some((x) => String(x).includes("No storage module present"))) {
      original(...a);
    }
  };
}

// scratch-vm's Node bundle reads an SVG default stylesheet at load time that the published package doesn't include.
// It is only used when rasterizing SVG costumes, which the projects don't have.
const readFileSync = fs.readFileSync;
fs.readFileSync = (p, ...rest) => {
  if (
    typeof p === "string" && p.endsWith("default-stylesheet.css") &&
    !fs.existsSync(p)
  ) return "";
  return readFileSync(p, ...rest);
};

process.stdout.on("error", () => process.exit(0));

const [vmName, file] = process.argv.slice(2);
if (!["scratch", "turbowarp"].includes(vmName) || !file) {
  console.error("usage: node node-vm.mjs <scratch|turbowarp> <project.sb3>");
  process.exit(2);
}

const VirtualMachine = require(
  vmName === "turbowarp" ? "turbowarp-vm" : "@scratch/scratch-vm",
);
fs.readFileSync = readFileSync;

const vm = new VirtualMachine();
if (vmName === "turbowarp") {
  vm.setCompilerOptions({ enabled: true, warpTimer: false });
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
