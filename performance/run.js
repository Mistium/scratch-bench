import fs from "fs";
import path from "path";
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
fs.readFileSync = function (p, ...rest) {
  if (
    typeof p === "string" && p.endsWith("default-stylesheet.css") &&
    !fs.existsSync(p)
  ) return "";
  return readFileSync.call(this, p, ...rest);
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const VirtualMachine = require(
  flag("--turbowarp") ? "turbowarp-vm" : "@scratch/scratch-vm",
);
fs.readFileSync = readFileSync;
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const file =
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--timeout") ||
  path.join(import.meta.dirname, "Scratch Performance Bench.sb3");
const timeoutMs = Number(opt("--timeout", 600)) * 1000;

const vm = new VirtualMachine();
vm.setTurboMode(flag("--turbo"));
if (flag("--turbowarp")) {
  vm.setCompilerOptions({ enabled: true, warpTimer: false });
}

vm.loadProject(fs.readFileSync(file)).then(() => {
  const stage = vm.runtime.getTargetForStage();
  const list = stage.lookupVariableByNameAndType("output", "list");
  if (!list) throw new Error('project has no list named "output"');

  const started = Date.now();
  let printed = 0;
  const poll = setInterval(() => {
    const lines = list.value;
    if (!flag("--json")) {
      while (printed < lines.length) console.log(lines[printed++]);
    }
    const done = lines[lines.length - 1] === "DONE";
    if (done || Date.now() - started > timeoutMs) {
      clearInterval(poll);
      vm.quit();
      if (flag("--json")) console.log(JSON.stringify(toJson(lines), null, 2));
      if (!done) {
        console.error(`timed out after ${timeoutMs / 1000}s without DONE`);
        process.exitCode = 1;
      }
      process.exit(process.exitCode || 0);
    }
  }, 100);

  vm.start();
  vm.greenFlag();
}).catch((e) => {
  console.error(e);
  process.exit(1);
});

function toJson(lines) {
  const results = {};
  for (const line of lines) {
    const p = line.split(" | ");
    if (p.length !== 6 || p[0] === "id") continue;
    results[p[0]] = {
      total_ms: Number(p[1]),
      ops: Number(p[2]),
      ops_per_ms: Number(p[3]),
      best_ops_per_ms: Number(p[4]),
      checksum: p[5],
    };
  }
  return results;
}
