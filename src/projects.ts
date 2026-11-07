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
}

/** Real time each replay may take before it stops and reports how far it got. */
export const BUDGET_MS = 30_000;

export const manifest = (): ProjectEntry[] =>
  JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, "manifest.json"), "utf8"));

export const projectFile = (id: string) => path.join(PROJECT_FILES, `${id}.sb3`);
export const recordingFile = (id: string) => path.join(PROJECTS_DIR, "recordings", `${id}.json`);

export interface BakedProject {
  id: string;
  title: string;
  sb3: string;
  ticks: number;
  recordedMs: number;
}

/** Each fetched project with its recording baked in (see bake.ts), in .cache/build/projects. */
export const bakeProjects = (log: (line: string) => void = () => {}): BakedProject[] => {
  const dir = path.join(BUILD_DIR, "projects");
  fs.mkdirSync(dir, { recursive: true });
  const out: BakedProject[] = [];
  for (const p of manifest()) {
    if (!fs.existsSync(projectFile(p.id))) continue;
    try {
      const files = unzip(fs.readFileSync(projectFile(p.id)));
      const recording: Recording = JSON.parse(fs.readFileSync(recordingFile(p.id), "utf8"));
      const baked = bake(
        JSON.parse(new TextDecoder().decode(files.get("project.json"))),
        recording,
        { id: p.id, budgetMs: BUDGET_MS },
      );
      files.set("project.json", new TextEncoder().encode(JSON.stringify(baked.project)));
      for (const [name, data] of baked.assets) files.set(name, data);
      const sb3 = path.join(dir, `${p.id}.sb3`);
      fs.writeFileSync(sb3, zip(files));
      out.push({ id: p.id, title: p.title, sb3, ticks: baked.ticks, recordedMs: baked.recordedMs });
    } catch (e) {
      log(`  ${p.id} ${p.title}: couldn't bake: ${(e as Error).message}`);
    }
  }
  return out;
};
