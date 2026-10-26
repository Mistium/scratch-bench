import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onCleanup } from "./cleanup.ts";
import type { Command } from "./runtimes/types.ts";

export type DisplayKind = "x11" | "wayland";

export interface Display {
  backend: string;
  wrap(c: Command): Command;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      v !== undefined &&
      !["DISPLAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE", "SDL_VIDEODRIVER"]
        .includes(k)
    ) env[k] = v;
  }
  return env;
};

const need = (bin: string, pkg: string) => {
  if (!Bun.which(bin)) {
    throw new Error(`${bin} is not installed (on Arch: pacman -S ${pkg})`);
  }
};

const startXvfb = async (): Promise<Display> => {
  need("Xvfb", "xorg-server-xvfb");
  let n = 100 + (process.pid % 800);
  while (
    fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)
  ) n++;
  const proc = Bun.spawn([
    "Xvfb",
    `:${n}`,
    "-screen",
    "0",
    "1280x720x24",
    "-nolisten",
    "tcp",
    "-ac",
  ], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  for (let i = 0; i < 100 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) {
    if (proc.exitCode !== null) throw new Error("Xvfb exited immediately");
    await sleep(50);
  }
  if (!fs.existsSync(`/tmp/.X11-unix/X${n}`)) {
    proc.kill("SIGKILL");
    throw new Error("Xvfb did not start");
  }
  const unregister = onCleanup(() => proc.kill("SIGKILL"));
  return {
    backend: "Xvfb",
    wrap: (c) => ({
      ...c,
      env: {
        ...cleanEnv(),
        ...c.env,
        DISPLAY: `:${n}`,
        XDG_SESSION_TYPE: "x11",
        SDL_VIDEODRIVER: "x11",
      },
    }),
    async stop() {
      unregister();
      proc.kill("SIGTERM");
      await proc.exited;
    },
  };
};

const startCage = async (): Promise<Display> => {
  need("cage", "cage");
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-wl-"));
  fs.chmodSync(runtimeDir, 0o700);
  const pulse = process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, "pulse/native")
    : "";
  const unregister = onCleanup(() =>
    fs.rmSync(runtimeDir, { recursive: true, force: true })
  );
  const audio: Record<string, string> = pulse && fs.existsSync(pulse)
    ? { PULSE_SERVER: `unix:${pulse}` }
    : {};
  return {
    backend: "cage",
    wrap: (c) => ({
      ...c,
      cmd: ["cage", "--", ...c.cmd],
      env: {
        ...cleanEnv(),
        ...c.env,
        XDG_RUNTIME_DIR: runtimeDir,
        XDG_SESSION_TYPE: "wayland",
        WLR_BACKENDS: "headless",
        WLR_RENDERER: "pixman",
        WLR_LIBINPUT_NO_DEVICES: "1",
        LIBGL_ALWAYS_SOFTWARE: "1",
        ...audio,
      },
    }),
    async stop() {
      unregister();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
};

export const startDisplay = (kind: DisplayKind): Promise<Display> => {
  return kind === "wayland" ? startCage() : startXvfb();
};
