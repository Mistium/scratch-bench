import crypto from "node:crypto";
import type {
  GitPart,
  HistoryPart,
  Pin,
  PinPart,
  Runtime,
  SuiteId,
} from "../runtimes/types.ts";
import type { Source } from "./source.ts";

const isGit = (p: HistoryPart): p is GitPart => "git" in p;

const providesFor = (
  part: HistoryPart,
  suite: SuiteId,
): Record<string, string> | string | null => {
  if (isGit(part)) {
    const entries = Object.entries(part.provides).filter(([name]) =>
      suite === "parity" || name === "vm"
    );
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return suite === "parity" || part.provides === "vm" ? part.provides : null;
};

export interface ResolveOptions {
  latest: boolean;
}

export const resolvePin = async (
  rt: Runtime,
  suite: SuiteId,
  date: string,
  source: Source,
  { latest }: ResolveOptions,
): Promise<Pin | null> => {
  const spec = rt.history;
  if (!spec) return null;
  const since = spec.since[suite];
  if (!since || date < since) return null;
  if (spec.latestOnly?.includes(suite) && !latest) return null;

  if (spec.custom) return spec.custom.resolve(date, suite);
  if (!spec.parts) return null;

  const parts: PinPart[] = [];
  for (const part of spec.parts) {
    const provides = providesFor(part, suite);
    if (!provides) continue;
    if (isGit(part)) {
      const dirs = Object.values(provides as Record<string, string>);
      const paths = dirs.every((d) => d === ".")
        ? undefined
        : [...dirs, ...(part.shared ?? [])];
      const commit = await source.gitHead(part.git, date, {
        branch: part.branch,
        paths,
      });
      if (!commit) return null;
      const have = { ...(provides as Record<string, string>) };
      for (const [name, from] of Object.entries(part.fallback ?? {})) {
        const sub = have[name];
        if (!sub || !source.pathExists) continue;
        if (await source.pathExists(part.git, commit, sub)) continue;
        delete have[name];
        if (typeof from === "string") {
          const version = await source.npmVersion(from, date);
          if (!version) return null;
          parts.push({ npm: from, version, provides: name });
        } else {
          const old = await source.gitHead(from.git, date, {
            branch: from.branch,
          });
          if (!old) return null;
          parts.push({
            git: from.git,
            commit: old,
            provides: { [name]: "." },
          });
        }
      }
      parts.push({
        git: part.git,
        commit,
        provides: have,
        shared: part.shared,
      });
    } else {
      const version = await source.npmVersion(part.npm, date);
      if (!version) return null;
      parts.push({ npm: part.npm, version, provides: provides as string });
    }
  }
  return parts.length ? { parts } : null;
};

export const pinHash = (runtime: string, suite: SuiteId, pin: Pin): string => {
  const canonical = JSON.stringify(
    { runtime, suite, pin },
    (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
        : v,
  );
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(
    0,
    16,
  );
};
