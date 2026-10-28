import type { Measured, MeasureOptions } from "../measure-suite.ts";
import type { DisplayKind } from "../display.ts";
import type { BenchProgress, WorkerProgress } from "../progress.ts";
import type {
  HistoricLaunch,
  Pin,
  PinPart,
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
  cleanup?(hash: string): void;
  resultsDir?: string;
}

export interface Options {
  runtimes: Runtime[];
  suites: SuiteId[];
  dates: string[];
  perfRuns: number;
  minRuns?: number;
  targetRsd?: number;
  timeoutMs: number;
  /** Timeout for a parity run; a normal one takes seconds, so a hang should not cost the full timeoutMs. */
  parityTimeoutMs?: number;
  displayKind: DisplayKind;
  limit?: number;
  dryRun: boolean;
  retryFailed: boolean;
  /** Measure the selected versions again even when they already have results, and replace those results. */
  redo?: boolean;
  /** Run every VM mode, not only each runtime's default. */
  variants?: boolean;
  /** Versions measured at the same time. Keep this at 1 for the cleanest timings. */
  jobs?: number;
  /** Performance versions built ahead while others are measured. */
  buildAhead?: number;
  /** CPU slots (taskset lists) for performance workers; worker i measures on slot i. */
  measureCpus?: string[];
  /** CPUs builds may use while performance runs are measured (taskset list); parity builds use every core. */
  buildCpus?: string;
  /** Parity versions checked at the same time. Parity is pass/fail, so this does not affect timings; it runs before any performance work. */
  parityJobs?: number;
  progress?: (p: Partial<BenchProgress>) => void;
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

const vmPart = (pin: Pin) =>
  pin.parts.find((p) => "git" in p && "vm" in p.provides) as
    | Extract<PinPart, { git: string }>
    | undefined;

/** The first line says which step failed; the cause is usually at the end of the tool's output. */
const brief = (err: unknown) => {
  const lines = String((err as Error).message).split("\n").map((l) =>
    l.trim()
  ).filter(Boolean);
  return [lines[0], ...lines.slice(1).slice(-8)].join(" | ").slice(0, 1200);
};

const pool = async <T>(
  items: T[],
  n: number,
  fn: (x: T, worker: number) => Promise<void>,
) => {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async (_, w) => {
      while (i < items.length) await fn(items[i++]!, w);
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
  o.progress?.({ phase: "planning", detail: "finding the version for each date" });
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
      if (o.variants === false) {
        variants = variants.filter((v) => v === null || v.default).slice(0, 1);
      }
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
    if (o.redo) return false;
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
        pin: st.pin ?? e.pin,
        hash: u.hash,
        force: o.redo,
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

  // Versions measured before are written out first, so the site has them while new ones are built and run (a run
  // can take hours, and the results folder may have been cleared).
  const handled = new Set(pending.map((u) => u.hash));
  for (const u of units.values()) {
    if (!handled.has(u.hash)) writeUnit(u);
  }

  const isParity = (pinH: string) =>
    distinct.get(pinH)![0]!.suite === "parity";
  // Take runtimes in turn (one version of each, then the next of each, ...) so a runtime with slow versions does not
  // hold every other runtime's results back until it is done.
  const interleave = (pins: string[]) => {
    const byRuntime = new Map<string, string[]>();
    for (const p of pins) {
      const id = distinct.get(p)![0]!.rt.id;
      byRuntime.set(id, [...(byRuntime.get(id) ?? []), p]);
    }
    const queues = [...byRuntime.values()];
    const out: string[] = [];
    for (let i = 0; out.length < pins.length; i++) {
      for (const q of queues) if (i < q.length) out.push(q[i]!);
    }
    return out;
  };
  const parityPins = interleave(pendingPins.filter(isParity));
  const perfPins = interleave(pendingPins.filter((p) => !isParity(p)));
  const parityJobs = Math.max(1, o.parityJobs ?? 1);
  const jobs = Math.max(1, o.jobs ?? 1);
  const total = pending.length;
  log(
    `\n${pendingPins.length} versions, each built, run, then cleaned up: ${parityPins.length} parity (${parityJobs} at a time), then ${perfPins.length} performance (${jobs} at a time)`,
  );
  let r = 0;
  o.progress?.({
    phase: "running",
    index: 0,
    total,
    detail: `${total} results to do`,
  });

  // What each worker, and each build running ahead of them, is doing; written to the progress file on every change.
  const activity = new Map<string, WorkerProgress>();
  const track = (
    id: string,
    now: Omit<WorkerProgress, "id" | "since"> | null,
  ) => {
    if (!now) activity.delete(id);
    else {
      const prev = activity.get(id);
      const same = prev && prev.state === now.state && prev.label === now.label;
      activity.set(id, {
        id,
        ...now,
        since: same ? prev.since : new Date().toISOString(),
      });
    }
    o.progress?.({ workers: [...activity.values()] });
  };

  const runOne = async (
    u: Unit,
    launch: HistoricLaunch,
    pin: Pin,
    cpus?: string,
    worker?: string,
  ) => {
    const e = distinct.get(u.pinHash)![0]!;
    const runs = e.suite === "parity" ? 1 : o.perfRuns;
    if (worker) {
      track(worker, { state: "running", label: unitLabel(u), cpus, detail: `run 1/${runs}` });
    }
    const suite = byId(e.suite);
    const index = ++r;
    mark(u, index);
    log(`  [${index}/${total}] ${unitLabel(u)}`);
    const measured = await deps.measure(
      suite,
      launch,
      suiteBuilds.get(e.suite)!.sb3,
      {
        runs: e.suite === "parity" ? 1 : o.perfRuns,
        minRuns: o.minRuns,
        targetRsd: o.targetRsd,
        timeoutMs: launch.timeoutMs ??
          (e.suite === "parity" ? o.parityTimeoutMs ?? o.timeoutMs : o.timeoutMs),
        displayKind: o.displayKind,
        variant: u.variant,
        cpus,
        onRun: (i, n, ok) => {
          if (worker) {
            track(worker, {
              state: "running",
              label: unitLabel(u),
              cpus,
              detail: `run ${Math.min(i + 1, n)}/${n} (run ${i} ${ok ? "ok" : "failed"})`,
            });
          }
          o.progress?.({
            phase: "running",
            suite: e.suite,
            runtime: e.rt.name,
            label: unitLabel(u),
            index,
            total,
            detail: `${unitLabel(u)}: run ${i}/${n}${ok ? "" : " failed"}`,
          });
        },
        log: (l) => log(`  ${l}`),
      },
    );
    const ok = measured.runs.some((x) => x.ok);
    if (ok) {
      saveMeasured(u.hash, measured);
      setState(u.hash, {
        status: "ok",
        note: launch.note,
        pin: pin === e.pin ? undefined : pin,
      });
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
    writeUnit(u);
  };

  // Opt-in per runtime: a version that does not build is replaced by the newest older commit of its vm repo that does,
  // never reaching the previous date's commit so two dates do not collapse into one. Commits that failed are remembered.
  const fallback = async (e: Entry, pinH: string, label: string, onTry?: (detail: string) => void) => {
    const n = e.rt.history?.fallback;
    const vm = vmPart(e.pin);
    if (!n || !vm || !deps.source.gitAncestors) return null;
    const first = distinct.get(pinH)!.map((x) => x.date).sort()[0]!;
    const previous = entries.find((x) =>
      x.rt === e.rt && x.suite === e.suite && x.date < first
    );
    const stop = previous && vmPart(previous.pin)?.commit;
    const dir = `${pinH}~fallback`;
    const ancestors = await deps.source.gitAncestors(vm.git, vm.commit, n);
    for (const [i, commit] of ancestors.entries()) {
      if (commit === stop) break;
      onTry?.(`did not build; trying ${commit.slice(0, 7)} (${i + 1}/${ancestors.length})`);
      const pin: Pin = {
        ...e.pin,
        parts: e.pin.parts.map((p) => (p === vm ? { ...vm, commit } : p)),
      };
      const key = `build:${pinHash(e.rt.id, e.suite, pin)}`;
      if (getState(key)?.status === "failed") continue;
      try {
        const launch = await deps.build(
          e.rt,
          e.suite,
          pin,
          dir,
          (l) => log(`    [${label} -> ${commit.slice(0, 7)}] ${l}`),
        );
        const note = `${vm.commit.slice(0, 7)} did not build; measured ${
          commit.slice(0, 7)
        }, the newest older commit that did`;
        log(`    [${label}] ${note}`);
        return {
          pin,
          dir,
          launch: {
            ...launch,
            note: [launch.note, note].filter(Boolean).join("; "),
          },
        };
      } catch (err) {
        setState(key, { status: "failed", stage: "build", error: brief(err) });
        (deps.cleanup ?? cleanupBuild)(dir);
      }
    }
    return null;
  };

  // One version at a time per worker: build it, run every VM mode of it, then delete the build, so disk use stays at
  // a few builds instead of growing with the whole plan.
  type Built = { launch: HistoricLaunch; pin: Pin; dir: string };

  // Builds a version (falling back to an older commit when the runtime allows it). Null means it did not build, and
  // its results are already recorded as failed.
  const buildPin = async (
    pinH: string,
    worker?: string,
  ): Promise<Built | null> => {
    const e = distinct.get(pinH)![0]!;
    const label = `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}`;
    // A build running ahead has no worker yet, so it is listed on its own until it finishes.
    const id = worker ?? `build ${label}`;
    track(id, { state: "building", label });
    try {
      return await buildOnly(pinH, e, label, (detail) => track(id, { state: "building", label, detail }));
    } finally {
      if (!worker) track(id, null);
    }
  };

  const buildOnly = async (
    pinH: string,
    e: Entry,
    label: string,
    onTry?: (detail: string) => void,
  ): Promise<Built | null> => {
    const mine = pending.filter((u) => u.pinHash === pinH);
    for (const u of mine) {
      if (o.redo || (o.retryFailed && getState(u.hash)?.status === "failed")) {
        forget(u.hash);
      }
    }
    o.progress?.({ phase: "building", detail: `building ${label}` });
    try {
      const launch = await deps.build(
        e.rt,
        e.suite,
        e.pin,
        pinH,
        (l) => log(`    [${label}] ${l}`),
      );
      sum.built++;
      return { launch, pin: e.pin, dir: pinH };
    } catch (err) {
      (deps.cleanup ?? cleanupBuild)(pinH);
      const built = await fallback(e, pinH, label, onTry).catch((fe) => {
        log(`    [${label}] fallback failed: ${brief(fe)}`);
        return null;
      });
      if (built) {
        sum.built++;
        return built;
      }
      const error = brief(err);
      for (const u of mine) {
        setState(u.hash, { status: "failed", stage: "build", error });
        sum.failed++;
        writeUnit(u);
      }
      r += mine.length;
      log(`  [${r}/${total}] BUILD FAILED ${label}: ${error}`);
      return null;
    }
  };

  // Runs every VM mode of a built version, then deletes the build.
  const runPin = async (
    pinH: string,
    built: Built,
    cpus?: string,
    worker?: string,
  ) => {
    try {
      for (const u of pending.filter((x) => x.pinHash === pinH)) {
        await runOne(u, built.launch, built.pin, cpus, worker);
      }
    } finally {
      (deps.cleanup ?? cleanupBuild)(built.dir);
    }
  };

  // One version at a time per worker: build it, run every VM mode of it, then delete the build, so disk use stays at
  // a few builds instead of growing with the whole plan.
  const doPin = async (pinH: string, w: number) => {
    const worker = `parity ${w + 1}`;
    try {
      const built = await buildPin(pinH, worker);
      if (built) await runPin(pinH, built, undefined, worker);
    } finally {
      track(worker, null);
    }
  };

  // Performance: `jobs` versions are measured at once, each worker pinned to its own CPU slot (o.measureCpus) so
  // runs do not share cores. The next `ahead` versions build meanwhile, so measuring never waits on a build; disk use
  // stays at jobs + ahead builds. Keep builds off the measuring cores or they disturb the timings.
  const perfPipeline = async (pins: string[], workers: number, ahead: number) => {
    const builds = new Map<string, Promise<Built | null>>();
    const start = (p: string) => {
      if (!builds.has(p)) builds.set(p, buildPin(p));
      return builds.get(p)!;
    };
    const slots = o.measureCpus ?? [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, pins.length) }, async (_, w) => {
        while (next < pins.length) {
          const k = next++;
          for (let j = k + 1; j <= k + ahead && j < pins.length; j++) {
            void start(pins[j]!);
          }
          const worker = `performance ${w + 1}`;
          const cpus = slots[w % slots.length];
          const e = distinct.get(pins[k]!)![0]!;
          track(worker, {
            state: "waiting for build",
            label: `${e.suite} / ${e.rt.id} @ ${describePin(e.pin).version}`,
            cpus,
          });
          const built = await start(pins[k]!);
          builds.delete(pins[k]!);
          if (built) await runPin(pins[k]!, built, cpus, worker);
          track(worker, null);
        }
      }),
    );
  };

  // Parity runs in parallel first; performance runs afterwards so parity does not disturb its timings.
  await pool(parityPins, parityJobs, doPin);
  // From here on runs are timed, so builds running ahead move off the measuring cores.
  if (o.buildCpus) process.env.BENCH_BUILD_CPUS = o.buildCpus;
  await perfPipeline(perfPins, jobs, o.buildAhead ?? 0);

  function mark(u: Unit, index: number) {
    const e = distinct.get(u.pinHash)![0]!;
    o.progress?.({
      phase: "running",
      suite: e.suite,
      runtime: e.rt.name,
      label: unitLabel(u),
      index,
      total,
      detail: `${index} of ${total} results`,
    });
  }

  return sum;
};
