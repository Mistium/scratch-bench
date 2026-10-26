import path from "node:path";

export const repoDir = (): string =>
  path.resolve(process.cwd(), process.env.BENCH_REPO_DIR ?? "..");

export const resultsDir = (): string =>
  path.resolve(repoDir(), process.env.BENCH_RESULTS_DIR ?? "results");
