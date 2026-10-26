import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BENCHMARKS, type CategoryId } from "../shared/benchmarks.ts";

export interface DemoOptions {
  nights: number;
  end?: Date;
  seed?: number;
}

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hash01 = (s: string) =>
  parseInt(crypto.createHash("sha1").update(s).digest("hex").slice(0, 8), 16) /
  0xffffffff;
const gauss = (r: () => number) =>
  Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

interface RuntimeSpec {
  id: string;
  name: string;
  kind: string;
  launcher: string;
  display: string | null;
  speed: Record<CategoryId, number>;
  startup: number;
  rss: number;
  bumpEvery: number;
  failRate: number;
  parityTotal: number;
  parityPassed: number;
}

const RUNTIMES: RuntimeSpec[] = [
  {
    id: "scratch",
    name: "Scratch",
    kind: "node",
    launcher: "headless",
    display: null,
    speed: {
      loops: 1,
      variables: 1,
      math: 1,
      strings: 1,
      lists: 1,
      algorithms: 1,
      applications: 1,
      scheduler: 1,
    },
    startup: 640,
    rss: 405,
    bumpEvery: 40,
    failRate: 0,
    parityTotal: 2123,
    parityPassed: 2123,
  },
  {
    id: "turbowarp",
    name: "TurboWarp",
    kind: "node",
    launcher: "headless",
    display: null,
    speed: {
      loops: 380,
      variables: 650,
      math: 260,
      strings: 38,
      lists: 95,
      algorithms: 150,
      applications: 210,
      scheduler: 4,
    },
    startup: 290,
    rss: 340,
    bumpEvery: 25,
    failRate: 0.01,
    parityTotal: 2123,
    parityPassed: 2107,
  },
  {
    id: "mistwarp",
    name: "MistWarp",
    kind: "node",
    launcher: "headless",
    display: null,
    speed: {
      loops: 375,
      variables: 640,
      math: 255,
      strings: 38,
      lists: 94,
      algorithms: 148,
      applications: 205,
      scheduler: 3.4,
    },
    startup: 300,
    rss: 345,
    bumpEvery: 18,
    failRate: 0.02,
    parityTotal: 2123,
    parityPassed: 2106,
  },
  {
    id: "nitrobolt",
    name: "NitroBolt",
    kind: "node",
    launcher: "headless",
    display: null,
    speed: {
      loops: 390,
      variables: 660,
      math: 270,
      strings: 41,
      lists: 100,
      algorithms: 158,
      applications: 225,
      scheduler: 3.8,
    },
    startup: 310,
    rss: 350,
    bumpEvery: 14,
    failRate: 0.02,
    parityTotal: 2123,
    parityPassed: 2088,
  },
  {
    id: "penguinmod",
    name: "PenguinMod",
    kind: "node",
    launcher: "headless",
    display: null,
    speed: {
      loops: 250,
      variables: 410,
      math: 160,
      strings: 30,
      lists: 70,
      algorithms: 95,
      applications: 120,
      scheduler: 2.4,
    },
    startup: 380,
    rss: 390,
    bumpEvery: 30,
    failRate: 0.03,
    parityTotal: 2123,
    parityPassed: 2026,
  },
  {
    id: "scratch-everywhere",
    name: "Scratch Everywhere!",
    kind: "native",
    launcher: "headless",
    display: null,
    speed: {
      loops: 11,
      variables: 11,
      math: 7,
      strings: 1.2,
      lists: 4.5,
      algorithms: 4.4,
      applications: 7,
      scheduler: 1.6,
    },
    startup: 20,
    rss: 57,
    bumpEvery: 7,
    failRate: 0.03,
    parityTotal: 2123,
    parityPassed: 1967,
  },
];

const CATEGORY_MAGNITUDE: Record<CategoryId, number> = {
  loops: 4000,
  variables: 900,
  math: 1000,
  strings: 1400,
  lists: 1300,
  algorithms: 700,
  applications: 120,
  scheduler: 600,
};

const baseOps = (id: string, category: CategoryId) =>
  CATEGORY_MAGNITUDE[category] * (0.15 + 3 * hash01(id));

const summary = (center: number, rsd: number, n: number, r: () => number) => {
  const xs = Array.from({ length: n }, () => center * (1 + rsd * gauss(r)));
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1
    ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    : 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const median = n % 2
    ? sorted[n >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n,
    median: round(median),
    mean: round(mean),
    stddev: round(sd),
    min: round(sorted[0]),
    max: round(sorted[n - 1]),
  };
};

const dirName = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

const hostFor = (name: "main" | "other") =>
  name === "main"
    ? {
      cpu: "AMD Ryzen 7 7840U w/ Radeon  780M Graphics",
      cores: 16,
      memory_gb: 46,
      os: "Linux 7.2.11-arch1-1",
      arch: "x64",
      node: "v26.12.1",
      bun: "1.4.4",
      chromium: "Chromium 156",
    }
    : {
      cpu: "Intel(R) Core(TM) i5-12400",
      cores: 12,
      memory_gb: 32,
      os: "Linux 6.8.0-ubuntu",
      arch: "x64",
      node: "v26.12.1",
      bun: "1.4.4",
      chromium: "Chromium 156",
    };

export const generate = (
  outDir: string,
  { nights, end = new Date(), seed = 1 }: DemoOptions,
) => {
  const r = rng(seed);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const reviseAt = Math.floor(nights * 0.55);
  let written = 0;

  for (let night = 0; night < nights; night++) {
    const when = new Date(end.getTime() - (nights - 1 - night) * 86_400_000);
    when.setUTCHours(3, 0, 0, 0);
    const hosts: ("main" | "other")[] = night >= nights - 10 && night % 2 === 0
      ? ["main", "other"]
      : ["main"];
    for (const host of hosts) {
      const stamp = new Date(
        when.getTime() + (host === "other" ? 3_600_000 : 0),
      );
      const runDir = path.join(outDir, dirName(stamp));
      fs.mkdirSync(runDir, { recursive: true });
      const hostSpeed = host === "main" ? 1 : 0.62;
      const suiteHash = night < reviseAt ? "demo-suite-a" : "demo-suite-b";
      const repo = {
        sha: crypto.createHash("sha1").update(`repo${night}`).digest("hex"),
        dirty: false,
        parity_sha: "demo-parity",
      };

      for (const rt of RUNTIMES) {
        const down = r() < rt.failRate;
        const bumps = Math.floor(night / rt.bumpEvery);
        const version = `1.${bumps}.0+${
          crypto.createHash("sha1").update(rt.id + bumps).digest("hex").slice(
            0,
            7,
          )
        }`;
        const improve = 1 + 0.025 * bumps;
        const base = {
          schema_version: 1,
          timestamp: stamp.toISOString(),
          suite: { id: "performance", source_hash: suiteHash },
          repo,
          runtime: {
            id: rt.id,
            name: rt.name,
            kind: rt.kind,
            version,
            detail: {},
            launcher: rt.launcher,
            display: rt.display,
          },
          host: hostFor(host),
        };
        const okRuns = down ? 0 : 10;
        const startup = rt.startup * (1 + 0.04 * gauss(r));
        const results: Record<string, unknown> = {};
        if (!down) {
          for (const b of BENCHMARKS) {
            const revision =
              suiteHash === "demo-suite-b" && b.category === "applications"
                ? 1.35
                : 1;
            const center = baseOps(b.id, b.category) * rt.speed[b.category] *
              improve * hostSpeed * revision;
            const rsd = b.category === "scheduler" ? 0.08 : 0.035;
            results[b.id] = {
              ops_per_ms: summary(center * (1 + 0.01 * gauss(r)), rsd, 10, r),
              total_ms: summary(603, 0.002, 10, r),
            };
          }
        }
        fs.writeFileSync(
          path.join(runDir, `performance-${rt.id}.json`),
          JSON.stringify({
            ...base,
            runs: Array.from(
              { length: 10 },
              (_, i) => (i < okRuns
                ? {
                  ok: true,
                  startup_ms: startup,
                  run_ms: 28000,
                  wall_ms: 28500,
                  peak_rss_mb: rt.rss,
                }
                : { ok: false, error: "exited before the suite finished" }),
            ),
            stats: down
              ? {
                startup_ms: null,
                run_ms: null,
                wall_ms: null,
                peak_rss_mb: null,
              }
              : {
                startup_ms: summary(startup, 0.04, 10, r),
                run_ms: summary(28000, 0.01, 10, r),
                wall_ms: summary(28500, 0.01, 10, r),
                peak_rss_mb: summary(rt.rss, 0.02, 10, r),
              },
            results,
          }),
        );
        written++;

        if (host === "main" && night % 3 === 0) {
          const fails = rt.parityTotal === 0;
          const wobble = fails
            ? 0
            : Math.round(rt.parityPassed + (r() < 0.1 ? -1 : 0));
          fs.writeFileSync(
            path.join(runDir, `parity-${rt.id}.json`),
            JSON.stringify({
              ...base,
              suite: { id: "parity", source_hash: "demo-parity-suite" },
              runs: [
                fails ? { ok: false, error: "timed out after 300s" } : {
                  ok: true,
                  startup_ms: 2200,
                  run_ms: 15000,
                  wall_ms: 17200,
                  peak_rss_mb: 210,
                },
              ],
              stats: {},
              results: fails ? null : {
                verdict: wobble === rt.parityTotal ? "passed" : "failed",
                passed: wobble,
                total: rt.parityTotal,
                failed_groups: wobble === rt.parityTotal ? [] : [{
                  name: "Looks: Colour and brightness effects",
                  passed: 5,
                  total: 15,
                }, { name: "Pen: Set Pen Color To", passed: 1, total: 10 }],
              },
            }),
          );
          written++;
        }
      }
      fs.writeFileSync(
        path.join(runDir, "meta.json"),
        JSON.stringify({
          schema_version: 1,
          timestamp: stamp.toISOString(),
          demo: true,
          host: hostFor(host),
          repo,
        }),
      );
    }
  }
  return written;
};

if (import.meta.main) {
  const out = path.resolve(
    process.argv[2] ?? path.join(import.meta.dir, "../.demo/results"),
  );
  const nights = Number(process.argv[3] ?? 120);
  const n = generate(out, { nights });
  console.log(`wrote ${n} result files for ${nights} nights to ${out}`);
}
