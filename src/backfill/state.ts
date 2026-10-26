import fs from "node:fs";
import path from "node:path";
import { CACHE } from "../paths.ts";
import type { Measured } from "../measure-suite.ts";

const dir = () =>
  process.env.BENCH_BACKFILL_DIR ?? path.join(CACHE, "backfill");
const file = () => path.join(dir(), "state.json");
const resultsDir = () => path.join(dir(), "results");

export interface PinState {
  status: "ok" | "failed";
  stage?: "build" | "run";
  error?: string;
  at: string;
  note?: string;
}

let state: Record<string, PinState> | null = null;

export const resetState = () => {
  state = null;
};

const load = () => {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    state = {};
  }
  return state!;
};

export const getState = (hash: string): PinState | undefined => load()[hash];

export const setState = (hash: string, s: Omit<PinState, "at">) => {
  load()[hash] = { ...s, at: new Date().toISOString() };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 1));
};

export const saveMeasured = (hash: string, m: Measured) => {
  fs.mkdirSync(resultsDir(), { recursive: true });
  fs.writeFileSync(path.join(resultsDir(), `${hash}.json`), JSON.stringify(m));
};

export const loadMeasured = (hash: string): Measured | null => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(resultsDir(), `${hash}.json`), "utf8"),
    );
  } catch {
    return null;
  }
};

export const forget = (hash: string) => {
  delete load()[hash];
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 1));
  fs.rmSync(path.join(resultsDir(), `${hash}.json`), { force: true });
};
