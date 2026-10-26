export interface Command {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface Launcher {
  command(sb3: string): Command;
  display?: boolean;
}

export interface SetupInfo {
  version: string;
  detail?: Record<string, string>;
}

export interface SetupOptions {
  offline: boolean;
  gui: boolean;
}

export type SuiteId = "performance" | "parity";

export interface GitPart {
  git: string;
  branch?: string;
  provides: Record<string, string>;
  shared?: string[];
}

export interface NpmPart {
  npm: string;
  provides: string;
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
  command(sb3: string): Command;
  display?: boolean;
  note?: string;
}

export interface HistorySpec {
  since: Partial<Record<SuiteId, string>>;
  latestOnly?: SuiteId[];
  parts?: HistoryPart[];
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
