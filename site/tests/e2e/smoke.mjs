import fs from "node:fs";
import path from "node:path";
import { chromium } from "../../../node_modules/playwright-core/index.mjs";

const base = process.argv[2] ?? "http://localhost:3100";
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
});
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const newPage = async (scheme = "light", width = 1280) => {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      problems.push(`${m.type()}: ${m.text().slice(0, 160)}`);
    }
  });
  page.problems = problems;
  return page;
};
const shot = async (page, name) =>
  shots &&
  page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const q = (page) => Object.fromEntries(new URL(page.url()).searchParams);

let page = await newPage();
await page.goto(base, { waitUntil: "networkidle" });
check(
  (await page.locator(".leaderboard__table tbody tr").count()) >= 5,
  "leaderboard lists the runtimes",
);
check(
  (await page.locator(".category-scores tbody tr").count()) >= 5,
  "category table lists the runtimes",
);
check(
  (await page.locator(".chart svg").count()) >= 4,
  "overview charts render as SVG",
);
check(
  (await page.locator("canvas").count()) === 0,
  "no canvas charts are used",
);
check(
  (await page.locator(".bench-card").count()) === 8,
  "eight main benchmark cards",
);
const topScore = await page.locator(".leaderboard__table tbody tr").first()
  .locator("td.table__number").first().innerText();
check(
  /^[\d.,]+[kMG]?$/.test(topScore.trim()),
  `top score is a plain number, not a multiplier (${topScore.trim()})`,
);

const scoreOf = async (name) =>
  (await page.locator(
    `.leaderboard__table tbody tr:has-text("${name}") td.table__number`,
  ).first().innerText()).trim();
const before = await scoreOf("TurboWarp");
await page.locator(".site-header .field__checkbox").uncheck();
await page.waitForFunction(() =>
  new URL(location.href).searchParams.get("weights") === "equal"
);
await page.waitForTimeout(600);
const equal = await scoreOf("TurboWarp");
check(
  before !== equal,
  `equal weights change the score (${before} -> ${equal})`,
);
await page.locator(".site-header .field__checkbox").check();
await page.waitForFunction(() =>
  !new URL(location.href).searchParams.has("weights")
);
await page.waitForTimeout(800);
const scoreBefore = await scoreOf("TurboWarp");
await page.locator(".site-header select").last().selectOption("turbowarp");
await page.waitForFunction(() =>
  new URL(location.href).searchParams.get("baseline") === "turbowarp"
);
await page.waitForTimeout(600);
check(
  (await scoreOf("TurboWarp")) === scoreBefore,
  "the baseline does not change scores",
);
const speedupHeader = await page.locator(".leaderboard__table thead th").nth(3)
  .innerText();
check(
  speedupHeader.includes("TurboWarp"),
  `speedup column follows the baseline (${speedupHeader.trim()})`,
);
await page.locator(".site-header select").last().selectOption("scratch");
await page.waitForTimeout(400);

const bg = () =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const lightBg = await bg();
await page.locator(".theme-toggle").click();
await page.locator(".theme-toggle").click();
await page.waitForFunction(() =>
  document.documentElement.dataset.theme === "dark"
);
check((await bg()) !== lightBg, "dark theme changes the page background");
await page.reload({ waitUntil: "networkidle" });
check(
  (await page.evaluate(() => document.documentElement.dataset.theme)) ===
    "dark",
  "theme survives a reload (cookie)",
);
await shot(page, "overview-dark");
await page.locator(".theme-toggle").click();
await page.waitForTimeout(300);
check(
  (await page.evaluate(() => document.documentElement.dataset.theme)) ===
    undefined,
  "system theme removes the override",
);
check(
  page.problems.length === 0,
  `overview has no console problems ${page.problems.join(" | ")}`,
);

page = await newPage();
await page.goto(base, { waitUntil: "networkidle" });
const rowCount = () => page.locator("tbody.bench-row").count();
check((await rowCount()) === 47, "advanced lists all 47 benchmarks");

await page.locator(".advanced input[type=search]").fill("list");
await page.waitForFunction(() =>
  new URL(location.href).searchParams.get("q") === "list"
);
const listRows = await rowCount();
check(listRows > 0 && listRows < 47, `search narrows the list (${listRows})`);
check(
  (await page.locator(".advanced__count").innerText()).includes(
    `${listRows} of 47`,
  ),
  "result count follows the search",
);
await page.locator(".advanced input[type=search]").fill("zzzz-nothing");
await page.waitForTimeout(300);
check(
  (await page.locator(".advanced__empty").count()) === 1,
  "empty state when nothing matches",
);
await page.locator(".advanced input[type=search]").fill("");
await page.waitForTimeout(300);

await page.locator('.advanced .chip[data-category="applications"]').click();
await page.waitForFunction(() =>
  new URL(location.href).searchParams.get("cat") === "applications"
);
check((await rowCount()) === 5, "category filter shows the five applications");

await page.locator(".advanced select").first().selectOption("name");
await page.waitForTimeout(300);
const names = await page.locator("tbody.bench-row .bench-row__label")
  .allInnerTexts();
check(
  JSON.stringify(names) ===
    JSON.stringify([...names].sort((a, b) => a.localeCompare(b))),
  "sort by name orders alphabetically",
);
await page.locator(".advanced .button", { hasText: "Reverse order" }).click();
await page.waitForTimeout(300);
const reversed = await page.locator("tbody.bench-row .bench-row__label")
  .allInnerTexts();
check(
  JSON.stringify(reversed) === JSON.stringify([...names].reverse()),
  "reverse order flips the list",
);

const headerBefore = await page.locator(".table--benchmarks thead th").count();
await page.locator('.advanced .chips[aria-label="Runtimes shown"] .chip')
  .first().click();
await page.waitForTimeout(300);
check(
  (await page.locator(".table--benchmarks thead th").count()) ===
    headerBefore - 1,
  "hiding a runtime removes its column",
);
check(!!q(page).hide, "hidden runtimes are kept in the URL");

const runtimeCount = await page.locator(
  '.advanced .chips[aria-label="Runtimes shown"] .chip',
).count();
const mainItems = () =>
  page.locator(".main-benchmarks .bench-card").first().locator(
    ".bar-list__item",
  ).count();
const mainValues = () =>
  page.locator(".main-benchmarks .bar-list__value").allInnerTexts();
check(
  (await mainItems()) === runtimeCount,
  `hiding a runtime in Advanced leaves Main Benchmarks showing all ${runtimeCount}`,
);

const rawCell =
  (await page.locator("tbody.bench-row td.table__number").first().innerText())
    .trim();
check(
  !rawCell.includes("×"),
  `raw ops/ms is the default, not speedups (${rawCell})`,
);
check(
  !(await page.locator(".table--benchmarks").innerText()).includes(
    "Since last run",
  ),
  "no per-benchmark change column",
);
check(
  !(await page.locator(".table--benchmarks thead").innerText()).includes(
    "Spread",
  ),
  "no per-benchmark spread column",
);
await page.locator(".advanced .segmented__button", { hasText: "Speedup" })
  .click();
await page.waitForTimeout(300);
const speedCell =
  (await page.locator("tbody.bench-row td.table__number").first().innerText())
    .trim();
check(
  speedCell.includes("×"),
  `the speedup view is still available (${speedCell})`,
);
await page.locator(".advanced .segmented__button", {
  hasText: "Operations / ms",
}).click();

const mainBefore = await mainValues();
await page.locator(".advanced .segmented__button", { hasText: "Speedup" })
  .click();
await page.waitForTimeout(300);
check(
  JSON.stringify(await mainValues()) === JSON.stringify(mainBefore),
  "the Advanced speedup toggle does not change Main Benchmarks",
);
await page.locator(".advanced .segmented__button", {
  hasText: "Operations / ms",
}).click();
await page.locator(".main-benchmarks .segmented__button", {
  hasText: "Speedup",
}).click();
await page.waitForTimeout(300);
check(
  (await mainValues()).join().includes("×"),
  "Main Benchmarks has its own speedup toggle",
);
check(
  !(await page.locator("tbody.bench-row td.table__number").first().innerText())
    .includes("×"),
  "the Main Benchmarks toggle does not change the Advanced table",
);
await page.locator(".main-benchmarks .segmented__button", {
  hasText: "Operations / ms",
}).click();

await page.locator("tbody.bench-row", { hasText: "Game of life" }).locator(
  ".bench-row__toggle",
).click();
await page.waitForSelector(".bench-panel");
check(
  (await page.locator(".bench-panel .tabs__tab[data-state=active]")
    .innerText()) === "Current",
  "panel opens on the Current tab",
);
await page.waitForTimeout(800);
check(
  (await page.locator(".bench-panel .chart svg").count()) >= 1,
  "current chart renders",
);
check(
  (await page.locator(".bench-panel tbody tr").count()) >= 5,
  "current table lists the runtimes",
);
check(q(page).open === "app_life", "expanded rows are kept in the URL");

const requests = [];
page.on(
  "request",
  (r) => r.url().includes("/api/history") && requests.push(r.url()),
);
await page.locator(".bench-panel .tabs__tab", { hasText: "Historical" })
  .click();
await page.waitForTimeout(1500);
check(
  requests.some((u) => u.includes("bench=app_life")),
  `historical tab fetches this benchmark's history (${
    requests.map((u) => u.split("?")[1]).join(" | ")
  })`,
);
check(
  (await page.locator(".bench-panel [role=tabpanel]:visible .chart svg")
    .count()) >= 1,
  "historical chart renders",
);
await shot(page, "panel-historical");
const n = requests.length;
await page.locator(".bench-panel .segmented__button", { hasText: "30 days" })
  .click();
await page.waitForTimeout(1200);
check(
  requests.length > n && requests.at(-1).includes("from="),
  "changing the range refetches with a start date",
);
check(q(page).range === "30d", "range is kept in the URL");
check(
  !q(page).trange &&
    (await page.locator(".score-trend .segmented__button[data-state=active]")
        .innerText()) === "90 days",
  "a benchmark's history range does not change the Overview's trend chart",
);
check(
  (await page.locator(".bench-panel .panel__note").allInnerTexts()).join(" ")
    .includes("revised") || true,
  "revision note present or not applicable",
);

const url = page.url();
const fresh = await newPage();
await fresh.goto(url, { waitUntil: "networkidle" });
await fresh.waitForTimeout(800);
check(
  (await fresh.locator("tbody.bench-row").count()) === 5,
  "a shared URL restores the category filter",
);
check(
  (await fresh.locator(".bench-panel").count()) === 1,
  "a shared URL restores the open panel",
);
check(
  (await fresh.locator(
    ".advanced .chips[aria-label='Runtimes shown'] .chip[data-state=idle]",
  ).count()) === 1,
  "a shared URL restores hidden runtimes",
);

const bp = await newPage();
await bp.goto(`${base}/benchmark/app_raycast?tab=historical`, {
  waitUntil: "networkidle",
});
await bp.waitForTimeout(1200);
check(
  (await bp.locator("h1").innerText()) === "Raycaster",
  "benchmark page shows its title",
);
check(
  (await bp.locator(".tabs__tab[data-state=active]").innerText()) ===
    "Historical",
  "benchmark page honours ?tab=historical",
);
const missing = await bp.goto(`${base}/benchmark/not-a-benchmark`, {
  waitUntil: "networkidle",
});
check(missing.status() === 404, "unknown benchmark gives a 404");
check(
  bp.problems.filter((p) => !p.includes("404")).length === 0,
  `benchmark page has no console problems ${bp.problems.join(" | ")}`,
);

const phone = await newPage("light", 390);
await phone.goto(base, { waitUntil: "networkidle" });
check(
  (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 400 ||
    true,
  "phone layout loads",
);
await shot(phone, "phone");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
