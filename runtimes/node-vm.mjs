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
  gandi: { pkg: "gandi-vm", compiler: true },
  "penguinmod-port": { pkg: "penguinmod-port-vm", compiler: true },
  // Installed from git, so "main" (an unbuilt dist/) is missing; its source runs under Node as it is.
  clipcc: { pkg: "clipcc-vm/src/index.js", compiler: false },
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

if (vmName === "penguinmod-port") {
  // It expects a browser's window and document while loading.
  const { parseHTML } = require("linkedom");
  const dom = parseHTML("<!doctype html><html><head></head><body></body></html>");
  Object.assign(globalThis, { window: dom.window, document: dom.document, DOMParser: dom.DOMParser });
  // Some of its files mix require() with import/export (src/serialization/pm-compat.js): webpack accepts that, but Node
  // loads them as ES modules, where require() does not exist. Compile those to CommonJS first.
  const Module = require("module");
  const { transformSync } = require("esbuild");
  const load = Module._extensions[".js"];
  Module._extensions[".js"] = (module, filename) => {
    const code = fs.readFileSync(filename, "utf8");
    if (!/\brequire\(/.test(code) || !/^\s*(export|import)\s/m.test(code)) return load(module, filename);
    module._compile(transformSync(code, { loader: "js", format: "cjs", target: "node18" }).code, filename);
  };
}

const VirtualMachine = require(process.env.BENCH_VM_DIR ?? VMS[vmName].pkg);
fs.readFileSync = readFileSync;

// ClipCC takes a config object whose extension manager loads a project's extensions (its GUI supplies one); stand in
// with one that loads Scratch's built-in extensions. The other VMs take no arguments.
const vm = vmName === "clipcc"
  ? new VirtualMachine({
    extensionManager: {
      emitEvent() {},
      emitEventToAll() {},
      getExtensionLoadOrder: (ids) => ids,
      loadExtensionsWithMode: (ids) =>
        ids.forEach((id) => vm.extensionManager.isExtensionLoaded(id) || vm.extensionManager.loadExtensionIdSync(id)),
    },
  })
  : new VirtualMachine();
// The port's code refers to the editor's global `vm`.
if (vmName === "penguinmod-port") globalThis.vm = vm;
if (vmName === "clipcc") {
  // ClipCC also gives every sprite a browser Audio element, which it only ever pauses and rewinds, and its dispose (run
  // on every project load) clears the renderer's skins without checking there is a renderer.
  globalThis.Audio ??= class {
    pause() {}
  };
  const dispose = vm.runtime.dispose;
  vm.runtime.dispose = function () {
    if (this.renderer) return dispose.call(this);
    this.renderer = { _allSkins: [] };
    try {
      return dispose.call(this);
    } finally {
      this.renderer = undefined;
    }
  };
}
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
