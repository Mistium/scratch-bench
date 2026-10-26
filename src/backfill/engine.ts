import type { Measured, MeasureOptions } from "../measure-suite.ts";
import type { DisplayKind } from "../display.ts";
import type {
  HistoricLaunch,
  Pin,
  Runtime,
  SuiteId,
} from "../runtimes/types.ts";
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
  /** The current project, built from source: { sb3, hash }. */
  suiteBuild(suite: Suite): Promise<{ sb3: string; hash: string }>;
  cleanup?(hash: string, keep: "bundle" | "none"): void;
  resultsDir?: string;
}

export interface Options {
  runtimes: Runtime[];
  suites: SuiteId[];
  /** Ascending dates; the last one is "latest" (for runtimes whose newest version is the only one that works). */
  dates: string[];
  perfRuns: number;
  timeoutMs: number;
  displayKind: DisplayKind;
  /** Stop after this many new builds+runs (for trying things out). */
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
}

const byId = (id: SuiteId) => SUITES.find((s) => s.id === id)!;

/** Run `fn` over items with at most `n` in flight. */
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
  };
  const latest = o.dates.at(-1);
  const descending = [...o.dates].reverse();

  /* ---- plan: what was each runtime on each date ---- */
  const entries: Entry[] = [];
  const suiteOrder: SuiteId[] = (["parity", "performance"] as const).filter((
    s,
  ) => o.suites.includes(s));
  for (const suite of suiteOrder) {
    for (const rt of o.runtimes) {
      if (!rt.history?.since[suite]) continue;
      const found: Entry[] = [];
      await pool(descending, 6, async (date) => {
        const pin = await resolvePin(rt, suite, date, deps.source, {
          latest: date === latest,
        });
        if (!pin) {
          sum.unavailable++;
          return;
        }
        found.push({ rt, suite, date, pin, hash: pinHash(rt.id, suite, pin) });
      });
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

  /* ---- what still has to be done ---- */
  const done = (hash: string) => {
    const st = getState(hash);
    if (!st) return false;
    if (st.status === "ok") return loadMeasured(hash) !== null;
    return !o.retryFailed;
  };
  let pending = [...distinct.keys()].filter((h) => !done(h));
  sum.cached = distinct.size - pending.length;
  if (o.limit !== undefined) pending = pending.slice(0, o.limit);

  if (o.dryRun) {
    log(
      `\nplan: ${entries.length} results over ${distinct.size} distinct versions; ${sum.cached} already done, ${pending.length} to do`,
    );
    for (const h of pending.slice(0, 15)) {
      const e = distinct.get(h)![0]!;
      log(
        `  ${e.suite.padEnd(11)} ${e.rt.id.padEnd(18)} ${
          describePin(e.pin).version.padEnd(10)
        } first needed ${e.date}`,
      );
    }
    if (pending.length > 15) log(`  ... and ${pending.length - 15} more`);
    return sum;
  }

  const suiteBuilds = new Map<SuiteId, { sb3: string; hash: string }>();
  for (const s of new Set(entries.map((e) => e.suite))) {
    suiteBuilds.set(s, await deps.suiteBuild(byId(s)));
  }

  const writeHash = (hash: string) => {
    const list = distinct.get(hash)!;
    const st = getState(hash);
    if (!st) return;
    const measured = st.status === "ok" ? loadMeasured(hash) : null;
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
        hash,
        suiteSourceHash: suiteBuild?.hash ?? "unknown",
        launcher: e.suite === "parity" ? "gui" : "headless",
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

  /* ---- build everything pending (parallel), then run it one at a time on an otherwise idle machine ---- */
  const launches = new Map<string, HistoricLaunch>();
  let n = 0;
  log(`\nbuilding ${pending.length} versions (${o.concurrency} at a time)`);
  await pool(pending, o.concurrency, async (hash) => {
    const e = distinct.get(hash)![0]!;
    const label = `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}`;
    if (o.retryFailed && getState(hash)?.status === "failed") forget(hash);
    try {
      launches.set(
        hash,
        await deps.build(
          e.rt,
          e.suite,
          e.pin,
          hash,
          (l) => log(`    [${label}] ${l}`),
        ),
      );
      log(`  [${++n}/${pending.length}] built ${label}`);
      sum.built++;
    } catch (err) {
      setState(hash, {
        status: "failed",
        stage: "build",
        error: String((err as Error).message).split("\n").slice(0, 3).join(
          " | ",
        ).slice(0, 400),
      });
      log(
        `  [${++n}/${pending.length}] BUILD FAILED ${label}: ${
          getState(hash)!.error
        }`,
      );
      sum.failed++;
      writeHash(hash);
    }
  });

  const runnable = pending.filter((h) => launches.has(h));
  log(`\nrunning ${runnable.length} versions, one at a time`);
  let r = 0;
  for (const hash of runnable) {
    const e = distinct.get(hash)![0]!;
    const suite = byId(e.suite);
    const label = `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}`;
    log(`  [${++r}/${runnable.length}] ${label}`);
    const measured = await deps.measure(
      suite,
      launches.get(hash)!,
      suiteBuilds.get(e.suite)!.sb3,
      {
        runs: e.suite === "parity" ? 1 : o.perfRuns,
        timeoutMs: o.timeoutMs,
        displayKind: o.displayKind,
        log: (l) => log(`  ${l}`),
      },
    );
    const ok = measured.runs.some((x) => x.ok);
    if (ok) {
      saveMeasured(hash, measured);
      setState(hash, { status: "ok", note: launches.get(hash)!.note });
      sum.ran++;
    } else {
      setState(hash, {
        status: "failed",
        stage: "run",
        error: measured.runs.find((x) => x.error)?.error ?? "no run completed",
      });
      sum.failed++;
      log(`    FAILED: ${getState(hash)!.error}`);
    }
    (deps.cleanup ?? cleanupBuild)(
      hash,
      e.suite === "parity" ? "bundle" : "none",
    );
    writeHash(hash);
  }

  for (const hash of distinct.keys()) {
    if (!pending.includes(hash)) writeHash(hash);
  }
  return sum;
};
