import fs from "node:fs";
import path from "node:path";
import { CACHE, ROOT } from "./paths.ts";

/** Real Scratch projects, each with a recording of someone using it (`projects/recordings`). */
export const PROJECTS_DIR = path.join(ROOT, "projects");
/** Where `bun run fetch-projects` puts the sb3s. They are not committed. */
export const PROJECT_FILES = path.join(CACHE, "projects");

export interface ProjectEntry {
  id: string;
  title: string;
  author: string;
  /** SHA-256 of the project file the recording was made with (its pinned copy in pianola). */
  sha256: string;
}

/** Real time each replay may take before it stops and reports how far it got. */
export const BUDGET_MS = 30_000;

export const manifest = (): ProjectEntry[] =>
  JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, "manifest.json"), "utf8"));

/** A project file, named by its SHA-256 like the pinned copies it comes from. */
export const projectFile = (p: ProjectEntry) => path.join(PROJECT_FILES, `${p.sha256}.sb3`);
export const recordingFile = (id: string) => path.join(PROJECTS_DIR, "recordings", `${id}.json`);

export interface ReplayProject {
  id: string;
  title: string;
  sb3: string;
  recording: string;
  frames: number;
}

/** The downloaded projects, each with its recording. */
export const replayProjects = (): ReplayProject[] =>
  manifest()
    .filter((p) => fs.existsSync(projectFile(p)))
    .map((p) => ({
      id: p.id,
      title: p.title,
      sb3: projectFile(p),
      recording: recordingFile(p.id),
      frames: JSON.parse(fs.readFileSync(recordingFile(p.id), "utf8")).frames,
    }));
