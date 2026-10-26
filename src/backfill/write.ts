// Writing backfilled results in the runner's own format. A real nightly result is never touched.

import fs from "node:fs";
import path from "node:path";
import { hostInfo, repoInfo } from "../hostinfo.ts";
import type { Measured } from "../measure-suite.ts";
import { RESULTS_DIR } from "../paths.ts";
import type { SuiteResult } from "../report.ts";
import type { Pin, Runtime, SuiteId } from "../runtimes/types.ts";
import { timestampFor } from "./schedule.ts";

export interface BackfillInfo {
  date: string;
  pin_hash: string;
  pin: Pin;
  measured_at: string;
  /** The date whose run this result copies, when the pinned versions did not change between the two dates. */
  reused_from?: string;
  note?: string;
}

/** A short, human version for a pin: the VM's commit or version, or the custom version a custom resolver gave. */
export const describePin = (
  pin: Pin,
): { version: string; detail: Record<string, string> } => {
  const detail: Record<string, string> = {};
  let version = pin.custom?.version ?? "";
  for (const p of pin.parts) {
    if ("git" in p) {
      for (const name of Object.keys(p.provides)) {
        detail[name] = `${p.git}@${p.commit.slice(0, 7)}`;
      }
      if (!version && "vm" in p.provides) version = p.commit.slice(0, 7);
    } else {
      detail[p.provides] = `${p.npm}@${p.version}`;
      if (!version && p.provides === "vm") version = p.version;
    }
  }
  for (const [k, v] of Object.entries(pin.custom ?? {})) detail[k] = v;
  return { version: version || "unknown", detail };
};

export const dirFor = (date: string, resultsDir = RESULTS_DIR) =>
  path.join(resultsDir, timestampFor(date).replace(/[:.]/g, "-"));

export type WriteOutcome = "written" | "unchanged" | "kept-real";

export const writeResult = (a: {
  rt: Runtime;
  suite: SuiteId;
  date: string;
  pin: Pin;
  hash: string;
  suiteSourceHash: string;
  launcher: "headless" | "gui";
  measured: Measured | null;
  error?: string;
  reusedFrom?: string;
  note?: string;
  resultsDir?: string;
}): WriteOutcome => {
  const dir = dirFor(a.date, a.resultsDir);
  const file = path.join(dir, `${a.suite}-${a.rt.id}.json`);
  const timestamp = timestampFor(a.date);

  if (fs.existsSync(file)) {
    let existing: { backfill?: BackfillInfo; error?: string } | null = null;
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    if (!existing?.backfill) return "kept-real"; // a real nightly result, or something we can't read: leave it alone
    if (
      existing.backfill.pin_hash === a.hash && !!existing.error === !!a.error
    ) return "unchanged";
  }

  const { version, detail } = describePin(a.pin);
  const body: SuiteResult & { backfill: BackfillInfo } = {
    schema_version: 1,
    timestamp,
    suite: { id: a.suite, source_hash: a.suiteSourceHash },
    repo: repoInfo(),
    runtime: {
      id: a.rt.id,
      name: a.rt.name,
      kind: a.rt.kind,
      version,
      detail,
      launcher: a.launcher,
      display: a.measured?.display ?? null,
    },
    host: hostInfo(),
    runs: a.measured?.runs ??
      [{
        ok: false,
        error: a.error,
        startup_ms: null,
        run_ms: null,
        wall_ms: null,
        peak_rss_mb: null,
      }],
    stats: a.measured?.stats ?? {},
    results: a.measured?.results ?? null,
    ...(a.error ? { error: a.error } : {}),
    backfill: {
      date: a.date,
      pin_hash: a.hash,
      pin: a.pin,
      measured_at: new Date().toISOString(),
      ...(a.reusedFrom ? { reused_from: a.reusedFrom } : {}),
      ...(a.note ? { note: a.note } : {}),
    },
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  const meta = path.join(dir, "meta.json");
  if (!fs.existsSync(meta)) {
    fs.writeFileSync(
      meta,
      JSON.stringify(
        {
          schema_version: 1,
          timestamp,
          host: body.host,
          repo: body.repo,
          backfill: true,
        },
        null,
        2,
      ) + "\n",
    );
  }
  return "written";
};
