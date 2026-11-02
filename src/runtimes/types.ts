export interface Command {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  projectLine?: RegExp;
}

export interface Launcher {
  /** `variant` is the VM mode being run, for runtimes whose modes are different programs rather than an env var. */
  command(sb3: string, variant?: Variant | null): Command;
  display?: boolean;
}

export interface Variant {
  id: string;
  name: string;
  default: boolean;
  env?: Record<string, string>;
  prepare?(sb3: string): void;
}

export type VariantInfo = Pick<Variant, "id" | "name" | "default">;

export interface SetupInfo {
  version: string;
  detail?: Record<string, string>;
  variants?: Variant[];
}

export interface SetupOptions {
  offline: boolean;
  gui: boolean;
}

export type SuiteId = "performance" | "parity";

/** Inclusive dates (YYYY-MM-DD) a part applies to, for a package that moved repos. */
interface PartWindow {
  since?: string;
  until?: string;
}

export interface GitPart extends PartWindow {
  git: string;
  branch?: string;
  provides: Record<string, string>;
  shared?: string[];
  fallback?: Record<string, string | { git: string; branch?: string }>;
}

export interface NpmPart extends PartWindow {
  npm: string;
  provides: string;
  /** Always this version, for a runtime that pins it, instead of the release current on each date. */
  version?: string;
  /** Take the newest release on each date even if it is a prerelease (Scratch's packages long published only those). */
  prerelease?: boolean;
}

export type HistoryPart = GitPart | NpmPart;

export type PinPart =
  | {
    git: string;
    commit: string;
    provides: Record<string, string>;
    shared?: string[];
  }
  | { npm: string; version: string; provides: string };

export interface Pin {
  parts: PinPart[];
  custom?: Record<string, string>;
}

export interface HistoricLaunch {
  /** `variant` is the VM mode being run, for runtimes whose modes are different programs rather than an env var. */
  command(sb3: string, variant?: Variant | null): Command;
  display?: boolean;
  note?: string;
  /** Overrides the run timeout, for a runtime known to be slow at this suite. */
  timeoutMs?: number;
}

export interface HistorySpec {
  since: Partial<Record<SuiteId, string>>;
  latestOnly?: SuiteId[];
  variants?: Variant[] | ((pin: Pin) => Promise<Variant[]>);
  parts?: HistoryPart[];
  /** When a version does not build, try up to this many older commits of its vm repo (never back to the previous date's), and measure the first that builds. */
  fallback?: number;
  custom?: {
    resolve(date: string, suite: SuiteId): Promise<Pin | null>;
    build(pin: Pin, suite: SuiteId): Promise<HistoricLaunch>;
  };
}

export interface Runtime {
  id: string;
  name: string;
  kind: "node" | "native";
  setup(opts: SetupOptions): Promise<SetupInfo>;
  headless?: Launcher;
  gui?: Launcher;
  history?: HistorySpec;
}
