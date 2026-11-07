import fs from "node:fs";
import path from "node:path";
import { bake, type Recording } from "./bake.ts";
import { BUILD_DIR, CACHE, ROOT } from "./paths.ts";
import { unzip, zip } from "./sb3.ts";

/** Real Scratch projects, each with a recording of someone using it (`projects/recordings`). */
export const PROJECTS_DIR = path.join(ROOT, "projects");
/** Where `bun run fetch-projects` puts the sb3s. They are not committed. */
export const PROJECT_FILES = path.join(CACHE, "projects");

export interface ProjectEntry {
  id: string;
  title: string;
  author: string;
  /** sha256 of the project.json the recording was made with. */
  sha256: string;
  /** In the short set the nightly run replays. */
  daily?: boolean;
}

/**
 * How much of each recording to replay. By default, the first 10 recorded seconds of the daily
 * set, for 30 seconds each at most, so the nightly run stays short; `--projects all` (or a list of
 * ids) replays whole recordings for up to 5 minutes each.
 */
export interface Selection {
  projects: ProjectEntry[];
  maxSeconds?: number;
  budgetMs: number;
}

export const manifest = (): ProjectEntry[] =>
  JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, "manifest.json"), "utf8"));

export const projectFile = (id: string) => path.join(PROJECT_FILES, `${id}.sb3`);
export const recordingFile = (id: string) => path.join(PROJECTS_DIR, "recordings", `${id}.json`);

export const selectProjects = (spec?: string): Selection => {
  const all = manifest();
  if (!spec) return { projects: all.filter((p) => p.daily), maxSeconds: 10, budgetMs: 30_000 };
  if (spec === "all") return { projects: all, budgetMs: 300_000 };
  const ids = spec.split(",").map((x) => x.trim()).filter(Boolean);
  for (const id of ids) {
    if (!all.some((p) => p.id === id)) throw new Error(`project ${id} is not in projects/manifest.json`);
  }
  return { projects: all.filter((p) => ids.includes(p.id)), budgetMs: 300_000 };
};

export interface BakedProject {
  id: string;
  title: string;
  sb3: string;
  ticks: number;
  recordedMs: number;
}

/** Each fetched project with its recording baked in (see bake.ts), in .cache/build/projects. */
export const bakeProjects = (s: Selection): BakedProject[] => {
  const dir = path.join(BUILD_DIR, "projects");
  fs.mkdirSync(dir, { recursive: true });
  const out: BakedProject[] = [];
  for (const p of s.projects) {
    if (!fs.existsSync(projectFile(p.id))) continue;
    const files = unzip(fs.readFileSync(projectFile(p.id)));
    const recording: Recording = JSON.parse(fs.readFileSync(recordingFile(p.id), "utf8"));
    const baked = bake(
      JSON.parse(new TextDecoder().decode(files.get("project.json"))),
      recording,
      { id: p.id, maxSeconds: s.maxSeconds, budgetMs: s.budgetMs },
    );
    files.set("project.json", new TextEncoder().encode(JSON.stringify(baked.project)));
    for (const [name, data] of baked.assets) files.set(name, data);
    const sb3 = path.join(dir, `${p.id}.sb3`);
    fs.writeFileSync(sb3, zip(files));
    out.push({ id: p.id, title: p.title, sb3, ticks: baked.ticks, recordedMs: baked.recordedMs });
  }
  return out;
};
