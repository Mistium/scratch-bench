import path from "node:path";
import { run } from "../webbundle.ts";
import type { Command } from "./types.ts";

export const REPO = "https://git.rotur.dev/Mist/oscratchl.git";

export const PROJECT_LINE = /^[^:|\[\]]+: (.*)$/;

const HEADLESS_FRAMES = "100000000";

export const compile = async (cwd: string, out: string): Promise<void> => {
  const osl = process.env.OSL_BIN ?? "osl";
  try {
    await run([osl, "compile", "src/main.osl", "-o", out], cwd);
  } catch (e) {
    throw new Error(
      `could not build oscratchl with ${osl} (the compiler has to match the source): ${
        (e as Error).message
      }\n` +
        "Set OSL_BIN to the compiler to use, or OSCRATCHL_BINARY to a binary you built yourself.",
    );
  }
};

export const headlessCommand = (bin: string, sb3: string): Command => ({
  cmd: [bin, sb3, "--headless", HEADLESS_FRAMES],
  cwd: path.dirname(bin),
  projectLine: PROJECT_LINE,
});

export const windowCommand = (bin: string, sb3: string): Command => ({
  cmd: [bin, sb3, "--mute"],
  cwd: path.dirname(bin),
  projectLine: PROJECT_LINE,
});
