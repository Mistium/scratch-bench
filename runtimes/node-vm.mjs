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
  gandi: { pkg: "gandi-vm", compiler: true },
  nitrobolt: { pkg: "nitrobolt-vm", compiler: true },
  penguinmod: { pkg: "penguinmod-vm", compiler: true },
  "penguinmod-port": { pkg: "penguinmod-port-vm", compiler: true },
  clipcc: { pkg: "clipcc-vm", compiler: false },
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

// Older scratch-vm versions point "main" at a webpack build (dist/) that a source checkout does not have; their source
// entry runs under Node as it is.
const vmEntry = (dir) => {
  const main = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8")).main;
  return main && !fs.existsSync(`${dir}/${main}`) && fs.existsSync(`${dir}/src/index.js`)
    ? `${dir}/src/index.js`
    : dir;
};
// Some VMs (old Gandi IDE) read localStorage while running; give them an empty in-memory one, like a fresh browser
// profile. Harmless for the rest, which never touch it under Node.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}
// PenguinMod's interpreted "broadcast and wait" sets `broadcastVar.isSent` on an undeclared name (a typo for
// util.stackFrame.broadcastVar), which throws and ends the run. A global of that name makes the stray write harmless.
globalThis.broadcastVar ??= {};
// Git-installed packages (ClipCC) are source checkouts too.
const vmPath = vmEntry(process.env.BENCH_VM_DIR ?? `${require.resolve(`${VMS[vmName].pkg}/package.json`).slice(0, -"/package.json".length)}`);
// Some older VMs expect a browser at load time (e.g. DOMPurify only sets itself up when window.document exists). Only
// then add a linkedom window and load again from scratch: modern VMs pick code paths by whether a window exists.
const loadVm = () => {
  try {
    return require(vmPath);
  } catch (e) {
    if (!/DOMPurify|window is not defined|document is not defined/.test(String(e))) throw e;
    const { parseHTML } = require("linkedom");
    const dom = parseHTML("<!doctype html><html><head></head><body></body></html>");
    globalThis.window ??= dom.window;
    globalThis.document ??= dom.document;
    globalThis.DOMParser ??= dom.DOMParser;
    for (const key of Object.keys(require.cache)) delete require.cache[key];
    return require(vmPath);
  }
};
const VirtualMachine = loadVm();
fs.readFileSync = readFileSync;

// ClipCC takes a config object (the others ignore it) whose extension manager loads a project's extensions; its GUI
// supplies one, so stand in with one that loads Scratch's built-in extensions.
const ccExtensions = {
  emitEvent() {},
  emitEventToAll() {},
  getExtensionLoadOrder: (ids) => ids,
  loadExtensionsWithMode: (ids) =>
    ids.forEach((id) => vm.extensionManager.isExtensionLoaded(id) || vm.extensionManager.loadExtensionIdSync(id)),
};
const vm = new VirtualMachine({ extensionManager: ccExtensions });
// Some VMs' code expects the editor's global (penguinmod-port refers to vm directly).
globalThis.vm = vm;
// ClipCC's dispose (run on every project load) clears the renderer's skins without checking there is a renderer.
if (vmName === "clipcc") {
  // It also gives every sprite a browser Audio element, which it only ever pauses and rewinds.
  globalThis.Audio ??= class {
    pause() {}
    play() {
      return Promise.resolve();
    }
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
        vm.quit?.(); // older VMs have no quit(); the process exits next anyway
        process.exit(0);
      }
    }
  }, 20);

  vm.start();
  vm.greenFlag();
  // PenguinMod's recursion check reads op.id from stack frames whose op is null, and crashes the whole run. The check
  // only decides whether a recursive call yields, so treat a frame it cannot read as not recursive.
  const proto = vm.runtime.threads[0] && Object.getPrototypeOf(vm.runtime.threads[0]);
  if (proto?.isRecursiveCall) {
    const isRecursiveCall = proto.isRecursiveCall;
    proto.isRecursiveCall = function (...args) {
      try {
        return isRecursiveCall.apply(this, args);
      } catch {
        return false;
      }
    };
  }
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
