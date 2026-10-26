import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "..");
export const CACHE = path.join(ROOT, ".cache");
export const BUILD_DIR = path.join(CACHE, "build");
export const RUNTIME_DIR = path.join(CACHE, "runtimes");
export const RESULTS_DIR = path.resolve(
  ROOT,
  process.env.BENCH_RESULTS_DIR ?? "results",
);
export const ADAPTERS = path.join(ROOT, "runtimes");
