import fs from "node:fs";
import path from "node:path";
import { CACHE } from "../paths.ts";
import { endOfDay } from "./schedule.ts";

export interface Source {
  gitHead(
    repo: string,
    date: string,
    opts: { branch?: string; paths?: string[] },
  ): Promise<string | null>;
  npmVersion(pkg: string, date: string): Promise<string | null>;
}

const API_CACHE = path.join(CACHE, "backfill", "api-cache.json");
const HOUR = 3_600_000;

type CacheEntry = { value: unknown; at: number; final: boolean };
let cache: Record<string, CacheEntry> | null = null;

const load = () => {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(API_CACHE, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
};

const save = () => {
  fs.mkdirSync(path.dirname(API_CACHE), { recursive: true });
  fs.writeFileSync(API_CACHE, JSON.stringify(cache));
};

const cached = async <T>(
  key: string,
  final: boolean,
  fetcher: () => Promise<T>,
): Promise<T> => {
  const c = load();
  const hit = c[key];
  if (hit && (hit.final || Date.now() - hit.at < HOUR)) return hit.value as T;
  const value = await fetcher();
  c[key] = { value, at: Date.now(), final };
  save();
  return value;
};

const isFinal = (date: string) =>
  Date.parse(`${date}T23:59:59Z`) < Date.now() - 24 * HOUR;

const gh = async (url: string, jq: string): Promise<string> => {
  const proc = Bun.spawn(["gh", "api", url, "--jq", jq], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new Error(`gh api ${url}: ${err.trim()}`);
  }
  return out.trim();
};

const commitBefore = async (
  repo: string,
  date: string,
  branch?: string,
  p?: string,
) => {
  const q = [
    `until=${endOfDay(date)}`,
    "per_page=1",
    branch ? `sha=${encodeURIComponent(branch)}` : "",
    p ? `path=${encodeURIComponent(p)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  const out = await gh(
    `repos/${repo}/commits?${q}`,
    '.[0] | if . then "\\(.sha) \\(.commit.committer.date)" else "" end',
  );
  if (!out) return null;
  const [sha, when] = out.split(" ");
  return { sha: sha!, when: when! };
};

const STABLE = /^\d+\.\d+\.\d+$/;

export const realSource: Source = {
  async gitHead(repo, date, { branch, paths }) {
    const key = `git|${repo}|${branch ?? ""}|${
      (paths ?? []).join(",")
    }|${date}`;
    return cached(key, isFinal(date), async () => {
      if (!paths || paths.length === 0) {
        return (await commitBefore(repo, date, branch))?.sha ?? null;
      }
      let newest: { sha: string; when: string } | null = null;
      for (const p of paths) {
        const c = await commitBefore(repo, date, branch, p);
        if (c && (!newest || c.when > newest.when)) newest = c;
      }
      return newest?.sha ?? null;
    });
  },

  async npmVersion(pkg, date) {
    const times = await cached(`npm|${pkg}`, false, async () => {
      const res = await fetch(
        `https://registry.npmjs.org/${pkg.replace("/", "%2F")}`,
      );
      if (!res.ok) throw new Error(`npm registry ${pkg}: HTTP ${res.status}`);
      const doc = (await res.json()) as { time: Record<string, string> };
      return Object.fromEntries(
        Object.entries(doc.time).filter(([k]) =>
          k !== "created" && k !== "modified"
        ),
      );
    });
    const until = endOfDay(date);
    const published = Object.entries(times)
      .filter(([, t]) => t <= until)
      .sort((a, b) => a[1].localeCompare(b[1]));
    const stable = published.filter(([v]) => STABLE.test(v));
    return (stable.at(-1) ?? published.at(-1))?.[0] ?? null;
  },
};
