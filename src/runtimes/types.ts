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
}

export interface Runtime {
  id: string;
  name: string;
  kind: "node" | "native";
  setup(opts: SetupOptions): Promise<SetupInfo>;
  headless?: Launcher;
  gui?: Launcher;
}
