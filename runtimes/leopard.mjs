// Runs a project in Leopard (sb-edit converts the .sb3 to JavaScript; Leopard runs that, no scratch-vm) in headless
// Chromium. usage: node leopard.mjs <project.sb3>
// LEOPARD_DIR: a folder whose node_modules has the sb-edit and leopard versions to use (default: this repo's).
import fs from "fs";
import http from "http";
import { createRequire } from "module";
import path from "path";
import JSZip from "jszip";
import { chromium } from "playwright-core";

process.stdout.on("error", () => process.exit(0));
const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: node leopard.mjs <project.sb3>");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const from = createRequire(path.join(process.env.LEOPARD_DIR ?? root, "package.json"));
const { Project } = from("sb-edit");

const zip = await JSZip.loadAsync(fs.readFileSync(file));
const pj = JSON.parse(await zip.file("project.json").async("string"));
// Scratch ignores calls to custom blocks that are not defined (e.g. TurboWarp's debug log block); sb-edit throws on
// them, so drop them first, as Scratch would.
for (const t of pj.targets) {
  const defs = new Set(
    Object.values(t.blocks).filter((b) => b?.opcode === "procedures_prototype").map((b) => b.mutation.proccode),
  );
  for (const [id, b] of Object.entries(t.blocks)) {
    if (b?.opcode !== "procedures_call" || defs.has(b.mutation.proccode)) continue;
    const parent = t.blocks[b.parent];
    const next = t.blocks[b.next];
    if (parent?.next === id) parent.next = b.next;
    else if (parent) for (const v of Object.values(parent.inputs)) if (v[1] === id) v[1] = b.next;
    if (next) Object.assign(next, { parent: b.parent, topLevel: b.topLevel, x: b.x, y: b.y });
    delete t.blocks[id];
  }
}
zip.file("project.json", JSON.stringify(pj));

let files;
try {
  const project = await Project.fromSb3(await zip.generateAsync({ type: "nodebuffer" }));
  files = project.toLeopard({
    leopardJSURL: "/__leopard.js",
    getAssetURL: ({ md5, ext }) => `/__assets/${md5}.${ext}`,
    autoplay: false,
  });
} catch (e) {
  console.error(`sb-edit could not convert the project: ${e?.stack ?? e}`);
  process.exit(1);
}

const PAGE = `<!doctype html><meta charset="utf-8"><div id="project"></div>
<script type="module">
import project from "/index.js";
window.project = project;
project.attach("#project");
window.dispatchEvent(new Event("bench-ready"));
</script>`;
const types = { ".js": "application/javascript", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
const leopardJs = path.join(path.dirname(from.resolve("leopard/package.json")), "dist/index.esm.js");

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const send = (body, ext) =>
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" }).end(body);
  if (url === "/favicon.ico") return res.writeHead(204).end();
  if (url === "/__bench.html") return send(PAGE, ".html");
  if (url === "/__leopard.js") return send(fs.readFileSync(leopardJs), ".js");
  if (url.startsWith("/__assets/")) {
    const entry = zip.file(url.slice("/__assets/".length));
    return entry ? send(await entry.async("nodebuffer"), path.extname(url)) : res.writeHead(404).end();
  }
  const f = files[url.replace(/^\/(\.\/)?/, "")];
  if (f !== undefined) return send(f, path.extname(url));
  console.error(`404 ${url}`);
  res.writeHead(404).end();
}).listen(0, "127.0.0.1", async () => {
  const exe = process.env.CHROME || (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: [
      ...(process.env.CHROME_NO_SANDBOX ? ["--no-sandbox"] : []),
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, async () => {
      await browser.close().catch(() => {});
      process.exit(143);
    });
  }
  const tab = await browser.newPage();
  // As in chromium-vm.mjs: an error repeating with no result printed means the project cannot proceed.
  let printed = false;
  const repeats = new Map();
  tab.on("pageerror", (e) => {
    console.error("pageerror", e.message);
    const n = (repeats.get(e.message) ?? 0) + 1;
    repeats.set(e.message, n);
    if (n >= 200 && !printed) {
      console.error(`stopping: "${e.message}" was thrown ${n} times before any result`);
      browser.close().catch(() => {}).finally(() => process.exit(1));
    }
  });
  const finished = new Promise((resolve) => {
    tab.on("console", (m) => {
      const text = m.text();
      if (text.startsWith("[PROJECT] ")) {
        printed = true;
        process.stdout.write(`${text}\n`);
      } else if (text === "[BENCH-IDLE]") resolve();
      else if (m.type() === "error") process.stderr.write(`${text}\n`);
    });
  });
  await tab.goto(`http://127.0.0.1:${server.address().port}/__bench.html`);
  // Same contract as the other runners: print the stage's "output" list as it grows, then report idle once no script
  // has run for two seconds.
  await tab.evaluate(() =>
    new Promise((resolve) => {
      const go = () => {
        const project = window.project;
        project.greenFlag();
        let printed = 0;
        let idleSince = null;
        setInterval(() => {
          const list = project.stage.vars.output;
          if (Array.isArray(list)) while (printed < list.length) console.log("[PROJECT] " + String(list[printed++]));
          if (project.runningTriggers.length) idleSince = null;
          else {
            idleSince = idleSince ?? Date.now();
            if (Date.now() - idleSince > 2000) {
              console.log("[BENCH-IDLE]");
              idleSince = Infinity;
            }
          }
        }, 50);
        resolve();
      };
      if (window.project) go();
      else window.addEventListener("bench-ready", go, { once: true });
    })
  );
  await finished;
  await browser.close();
  server.close();
  process.exit(0);
});
