// usage: bun run fetch-projects [id ...]
// Downloads the projects in projects/manifest.json from scratch.mit.edu into .cache/projects as sb3
// files. A project whose project.json no longer matches the manifest's sha256 was edited after it
// was recorded, so it is skipped rather than replayed against the wrong version.
import fs from "node:fs";
import { manifest, PROJECT_FILES, projectFile, type ProjectEntry } from "./projects.ts";
import { unzip, zip } from "./sb3.ts";

const UA = { "User-Agent": "scratch-bench (github.com/gradylink/scratch-bench)" };

const get = async (url: string): Promise<Uint8Array> => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if (attempt === 3 || res.status === 404) throw new Error(`${res.status} ${url}`);
    await Bun.sleep(1000 * attempt);
  }
};

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** Written whole or not at all, so an interrupted fetch never leaves a broken sb3 behind. */
const save = (id: string, data: Uint8Array) => {
  fs.writeFileSync(`${projectFile(id)}.part`, data);
  fs.renameSync(`${projectFile(id)}.part`, projectFile(id));
};

const fetchProject = async (id: string, want: string): Promise<string> => {
  const meta = JSON.parse(
    new TextDecoder().decode(await get(`https://api.scratch.mit.edu/projects/${id}`)),
  );
  const raw = await get(`https://projects.scratch.mit.edu/${id}?token=${meta.project_token}`);
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  const json = isZip ? unzip(raw).get("project.json") : raw;
  if (!json) throw new Error("no project.json in the downloaded sb3");
  if (sha256(json) !== want) return "changed since it was recorded, skipped";
  if (isZip) {
    save(id, raw);
    return "fetched";
  }
  const project = JSON.parse(new TextDecoder().decode(json));
  const assets = new Map<string, Uint8Array>();
  for (const target of project.targets) {
    for (const asset of [...target.costumes, ...target.sounds]) {
      const name = asset.md5ext ?? `${asset.assetId}.${asset.dataFormat}`;
      if (!assets.has(name)) {
        assets.set(name, await get(`https://assets.scratch.mit.edu/internalapi/asset/${name}/get/`));
      }
    }
  }
  save(id, zip([["project.json", json], ...assets]));
  return "fetched";
};

/** Fetches the projects not downloaded yet; returns how many couldn't be. */
export const fetchProjects = async (
  wanted: ProjectEntry[],
  log: (line: string) => void,
): Promise<number> => {
  fs.mkdirSync(PROJECT_FILES, { recursive: true });
  const missing = wanted.filter((p) => !fs.existsSync(projectFile(p.id)));
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const p = missing[next++];
      try {
        const status = await fetchProject(p.id, p.sha256);
        if (status !== "fetched") failed++;
        log(`${p.id} ${p.title}: ${status}`);
      } catch (e) {
        failed++;
        log(`${p.id} ${p.title}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return failed;
};

if (import.meta.main) {
  const only = new Set(process.argv.slice(2));
  const wanted = manifest().filter((p) => !only.size || only.has(p.id));
  for (const id of only) {
    if (!wanted.some((p) => p.id === id)) console.log(`${id}: not in projects/manifest.json`);
  }
  await fetchProjects(wanted, console.log);
  const have = wanted.filter((p) => fs.existsSync(projectFile(p.id))).length;
  console.log(`${have} of ${wanted.length} projects in ${PROJECT_FILES}`);
  process.exit(have ? 0 : 1);
}
