import type { Measured, MeasureOptions } from "../measure-suite.ts";
import type { DisplayKind } from "../display.ts";
import type {
  HistoricLaunch,
  Pin,
  Runtime,
  SuiteId,
  Variant,
} from "../runtimes/types.ts";
import { infoOf } from "../variants.ts";
import { type Suite, SUITES } from "../suites.ts";
import { cleanup as cleanupBuild } from "./build.ts";
import { pinHash, resolvePin } from "./resolve.ts";
import type { Source } from "./source.ts";
import {
  forget,
  getState,
  loadMeasured,
  saveMeasured,
  setState,
} from "./state.ts";
import { describePin, writeResult } from "./write.ts";

export interface Deps {
  source: Source;
  build(
    rt: Runtime,
    suite: SuiteId,
    pin: Pin,
    hash: string,
    log: (l: string) => void,
  ): Promise<HistoricLaunch>;
  measure(
    suite: Suite,
    launch: HistoricLaunch,
    sb3: string,
    o: MeasureOptions,
  ): Promise<Measured>;
  suiteBuild(suite: Suite): Promise<{ sb3: string; hash: string }>;
  cleanup?(hash: string, keep: "bundle" | "none"): void;
  resultsDir?: string;
}

export interface Options {
  runtimes: Runtime[];
  suites: SuiteId[];
  dates: string[];
  perfRuns: number;
  timeoutMs: number;
  displayKind: DisplayKind;
  limit?: number;
  dryRun: boolean;
  retryFailed: boolean;
  concurrency: number;
  log: (line: string) => void;
}

interface Entry {
  rt: Runtime;
  suite: SuiteId;
  date: string;
  pin: Pin;
  hash: string;
}

interface Unit {
  pinHash: string;
  variant: Variant | null;
  hash: string;
}

const variantsOf = async (
  rt: Runtime,
  pin: Pin,
): Promise<(Variant | null)[]> => {
  const v = rt.history?.variants;
  const list = typeof v === "function" ? await v(pin) : v;
  return list?.length ? list : [null];
};

export interface Summary {
  resolved: number;
  unavailable: number;
  distinct: number;
  built: number;
  ran: number;
  failed: number;
  cached: number;
  written: number;
  keptReal: number;
  errors: number;
}

const byId = (id: SuiteId) => SUITES.find((s) => s.id === id)!;

const pool = async <T>(items: T[], n: number, fn: (x: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
};

export const backfill = async (o: Options, deps: Deps): Promise<Summary> => {
  const { log } = o;
  const sum: Summary = {
    resolved: 0,
    unavailable: 0,
    distinct: 0,
    built: 0,
    ran: 0,
    failed: 0,
    cached: 0,
    written: 0,
    keptReal: 0,
    errors: 0,
  };
  const latest = o.dates.at(-1);
  const descending = [...o.dates].reverse();

  const entries: Entry[] = [];
  const suiteOrder: SuiteId[] = (["parity", "performance"] as const).filter((
    s,
  ) => o.suites.includes(s));
  for (const suite of suiteOrder) {
    for (const rt of o.runtimes) {
      if (!rt.history?.since[suite]) continue;
      const found: Entry[] = [];
      try {
        await pool(descending, 6, async (date) => {
          const pin = await resolvePin(rt, suite, date, deps.source, {
            latest: date === latest,
          });
          if (!pin) {
            sum.unavailable++;
            return;
          }
          found.push({
            rt,
            suite,
            date,
            pin,
            hash: pinHash(rt.id, suite, pin),
          });
        });
      } catch (e) {
        sum.errors++;
        log(
          `could not plan ${suite} / ${rt.name}, skipping it: ${
            String((e as Error).message).split("\n")[0]!.slice(0, 300)
          }`,
        );
        continue;
      }
      found.sort((a, b) => b.date.localeCompare(a.date));
      entries.push(...found);
      sum.resolved += found.length;
      log(
        `planned ${suite} / ${rt.name}: ${found.length} dates, ${
          new Set(found.map((e) => e.hash)).size
        } distinct versions`,
      );
    }
  }

  const distinct = new Map<string, Entry[]>();
  for (const e of entries) {
    distinct.set(e.hash, [...(distinct.get(e.hash) ?? []), e]);
  }
  sum.distinct = distinct.size;

  const units = new Map<string, Unit>();
  const pinUnits = new Map<string, Unit[]>();
  for (const [pinH, list] of distinct) {
    const list2: Unit[] = [];
    let variants: (Variant | null)[];
    try {
      variants = await variantsOf(list[0]!.rt, list[0]!.pin);
    } catch (e) {
      sum.errors++;
      log(
        `could not tell which VM modes ${list[0]!.rt.name} has at ${
          describePin(list[0]!.pin).version
        }, skipping it: ${
          String((e as Error).message).split("\n")[0]!.slice(0, 200)
        }`,
      );
      continue;
    }
    for (const v of variants) {
      const unit: Unit = {
        pinHash: pinH,
        variant: v,
        hash: v ? `${pinH}~${v.id}` : pinH,
      };
      units.set(unit.hash, unit);
      list2.push(unit);
    }
    pinUnits.set(pinH, list2);
  }

  const done = (hash: string) => {
    const st = getState(hash);
    if (!st) return false;
    if (st.status === "ok") return loadMeasured(hash) !== null;
    return !o.retryFailed;
  };
  let pending = [...units.values()].filter((u) => !done(u.hash));
  sum.cached = units.size - pending.length;
  if (o.limit !== undefined) pending = pending.slice(0, o.limit);
  const pendingPins = [...new Set(pending.map((u) => u.pinHash))];
  const unitLabel = (u: Unit) => {
    const e = distinct.get(u.pinHash)![0]!;
    return `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}${
      u.variant ? ` (${u.variant.name})` : ""
    }`;
  };

  if (o.dryRun) {
    log(
      `\nplan: ${entries.length} results over ${distinct.size} distinct versions in ${units.size} VM modes; ${sum.cached} already done, ${pending.length} to do`,
    );
    for (const u of pending.slice(0, 15)) {
      const e = distinct.get(u.pinHash)![0]!;
      log(
        `  ${e.suite.padEnd(11)} ${e.rt.id.padEnd(18)} ${
          describePin(e.pin).version.padEnd(10)
        } ${(u.variant?.name ?? "").padEnd(12)} first needed ${e.date}`,
      );
    }
    if (pending.length > 15) log(`  ... and ${pending.length - 15} more`);
    return sum;
  }

  const suiteBuilds = new Map<SuiteId, { sb3: string; hash: string }>();
  for (const s of new Set(entries.map((e) => e.suite))) {
    suiteBuilds.set(s, await deps.suiteBuild(byId(s)));
  }

  const writeUnit = (u: Unit) => {
    const list = distinct.get(u.pinHash)!;
    const st = getState(u.hash);
    if (!st) return;
    const measured = st.status === "ok" ? loadMeasured(u.hash) : null;
    const chronological = [...list].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    for (const e of chronological) {
      const suiteBuild = suiteBuilds.get(e.suite);
      const outcome = writeResult({
        rt: e.rt,
        suite: e.suite,
        date: e.date,
        pin: e.pin,
        hash: u.hash,
        suiteSourceHash: suiteBuild?.hash ?? "unknown",
        launcher: e.suite === "parity" ? "gui" : "headless",
        variant: u.variant ? infoOf(u.variant) : null,
        measured,
        error: st.status === "failed"
          ? `${st.stage} failed: ${st.error}`
          : undefined,
        reusedFrom: e.date === chronological[0]!.date
          ? undefined
          : chronological[0]!.date,
        note: st.note,
        resultsDir: deps.resultsDir,
      });
      if (outcome === "written") sum.written++;
      if (outcome === "kept-real") sum.keptReal++;
    }
  };

  const launches = new Map<string, HistoricLaunch>();
  let n = 0;
  log(`\nbuilding ${pendingPins.length} versions (${o.concurrency} at a time)`);
  await pool(pendingPins, o.concurrency, async (pinH) => {
    const e = distinct.get(pinH)![0]!;
    const label = `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}`;
    const mine = pending.filter((u) => u.pinHash === pinH);
    for (const u of mine) {
      if (o.retryFailed && getState(u.hash)?.status === "failed") {
        forget(u.hash);
      }
    }
    try {
      launches.set(
        pinH,
        await deps.build(
          e.rt,
          e.suite,
          e.pin,
          pinH,
          (l) => log(`    [${label}] ${l}`),
        ),
      );
      log(`  [${++n}/${pendingPins.length}] built ${label}`);
      sum.built++;
    } catch (err) {
      const error = String((err as Error).message).split("\n").slice(0, 3).join(
        " | ",
      ).slice(0, 400);
      for (const u of mine) {
        setState(u.hash, { status: "failed", stage: "build", error });
        sum.failed++;
        writeUnit(u);
      }
      log(`  [${++n}/${pendingPins.length}] BUILD FAILED ${label}: ${error}`);
    }
  });

  const runnable = pending.filter((u) => launches.has(u.pinHash));
  const remaining = new Map<string, number>();
  for (const u of runnable) {
    remaining.set(u.pinHash, (remaining.get(u.pinHash) ?? 0) + 1);
  }
  log(`\nrunning ${runnable.length} versions, one at a time`);
  let r = 0;
  for (const u of runnable) {
    const e = distinct.get(u.pinHash)![0]!;
    const suite = byId(e.suite);
    const launch = launches.get(u.pinHash)!;
    log(`  [${++r}/${runnable.length}] ${unitLabel(u)}`);
    const measured = await deps.measure(
      suite,
      launch,
      suiteBuilds.get(e.suite)!.sb3,
      {
        runs: e.suite === "parity" ? 1 : o.perfRuns,
        timeoutMs: o.timeoutMs,
        displayKind: o.displayKind,
        variant: u.variant,
        log: (l) => log(`  ${l}`),
      },
    );
    const ok = measured.runs.some((x) => x.ok);
    if (ok) {
      saveMeasured(u.hash, measured);
      setState(u.hash, { status: "ok", note: launch.note });
      sum.ran++;
    } else {
      setState(u.hash, {
        status: "failed",
        stage: "run",
        error: measured.runs.find((x) => x.error)?.error ?? "no run completed",
      });
      sum.failed++;
      log(`    FAILED: ${getState(u.hash)!.error}`);
    }
    const left = (remaining.get(u.pinHash) ?? 1) - 1;
    remaining.set(u.pinHash, left);
    if (left === 0) {
      (deps.cleanup ?? cleanupBuild)(
        u.pinHash,
        e.suite === "parity" ? "bundle" : "none",
      );
    }
    writeUnit(u);
  }

  const handled = new Set(pending.map((u) => u.hash));
  for (const u of units.values()) {
    if (!handled.has(u.hash)) writeUnit(u);
  }
  return sum;
};
