// Runs a project in forkphorus (a JavaScript compiler for Scratch, not a scratch-vm fork) in headless Chromium.
// usage: node forkphorus.mjs <forkphorus checkout> <project.sb3>
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright-core";

process.stdout.on("error", () => process.exit(0));
const [dir, file] = process.argv.slice(2);
if (!dir || !file || !fs.existsSync(path.join(dir, "phosphorus.dist.js"))) {
  console.error(
    "usage: node forkphorus.mjs <forkphorus checkout with phosphorus.dist.js> <project.sb3>",
  );
  process.exit(2);
}
const page = path.join(import.meta.dirname, "forkphorus/bench.html");
// Load what the checkout's own player page loads (its libraries change over time), minus site-only extras.
const pageScripts = (() => {
  for (const name of ["embed.html", "index.html"]) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) continue;
    const srcs = [
      ...fs.readFileSync(f, "utf8").matchAll(/<script[^>]*\bsrc="([^"]+)"/g),
    ].map((m) => m[1])
      .filter((s) =>
        !/^(https?:)?\/\//.test(s) && !/studioview|analytics/.test(s)
      );
    if (srcs.some((s) => s.endsWith("phosphorus.dist.js"))) return srcs;
  }
  return ["phosphorus.dist.js"];
})();
const types = {
  ".js": "application/javascript",
  ".html": "text/html",
  ".json": "application/json",
  ".css": "text/css",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  // The bench page and project sit at the root, so relative URLs (the player, its fonts and sounds) resolve to the
  // checkout as they would on forkphorus' own site.
  const p = url === "/__bench.html"
    ? page
    : url === "/__bench.sb3"
    ? path.resolve(file)
    : path.join(dir, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(p, (e, d) => {
    if (e) res.writeHead(404).end();
    else {res.writeHead(200, {
        "Content-Type": types[path.extname(p)] || "application/octet-stream",
      }).end(d);}
  });
}).listen(0, "127.0.0.1", async () => {
  const exe = process.env.CHROME ||
    (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
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
      console.error(
        `stopping: "${e.message}" was thrown ${n} times before any result`,
      );
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
    });
  });
  await tab.goto(`http://127.0.0.1:${server.address().port}/__bench.html`);
  await tab.evaluate((scripts) => window.start(scripts), pageScripts);
  await finished;
  await browser.close();
  server.close();
  process.exit(0);
});
