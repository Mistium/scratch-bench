import fs from "fs";
import http from "http";
import path from "path";
import { createRequire } from "module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
process.stdout.on("error", () => process.exit(0));

const [kind, file] = process.argv.slice(2);
if (!["scratch", "turbowarp"].includes(kind) || !file) {
  console.error(
    "usage: node chromium-vm.mjs <scratch|turbowarp> <project.sb3>",
  );
  process.exit(2);
}

const audioPath = path.join(root, ".cache", "runtimes", "web", "audio.js");
if (!fs.existsSync(audioPath)) {
  const { buildSync } = require("esbuild");
  const out = buildSync({
    entryPoints: [require.resolve("scratch-audio")],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "ScratchAudio",
    write: false,
  }).outputFiles[0].text;
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, out);
}

const types = {
  ".js": "application/javascript",
  ".html": "text/html",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let p;
  if (url === "/" || url === "/index.html") {
    p = path.join(root, "runtimes/chromium/index.html");
  } else if (url === "/audio.js") p = audioPath;
  else if (url === "/project.sb3") p = path.resolve(file);
  else if (url.startsWith("/node_modules/")) p = path.join(root, url);
  else if (/^\/(chunks|assets)\//.test(url)) {
    p = [
      "@scratch/scratch-vm",
      "@scratch/scratch-svg-renderer",
      "@scratch/scratch-render",
      "@scratch/scratch-storage",
    ].map((m) => path.join(root, "node_modules", m, "dist/web", url))
      .find((c) => fs.existsSync(c));
  }
  if (!p) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(p, (e, d) => {
    if (e) res.writeHead(404).end();
    else {
      res.writeHead(200, {
        "Content-Type": types[path.extname(p)] || "application/octet-stream",
      });
      res.end(d);
    }
  });
}).listen(0, "127.0.0.1", async () => {
  const exe = process.env.CHROME ||
    (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const finished = new Promise((resolve) => {
    page.on("console", (m) => {
      const text = m.text();
      if (text.startsWith("[PROJECT] ")) process.stdout.write(`${text}\n`);
      else if (text === "[BENCH-IDLE]") resolve();
    });
  });
  await page.evaluate((k) => window.start(k), kind);
  await finished;
  await browser.close();
  server.close();
  process.exit(0);
});
