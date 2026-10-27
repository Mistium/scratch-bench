import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vmVariants } from "./runtimes/scratch-everywhere-history.ts";
import type { Variant } from "./runtimes/types.ts";
import {
  COMPILER_VARIANTS,
  labelOf,
  resultFileName,
  variantsToRun,
  withVariant,
} from "./variants.ts";

describe("variantsToRun", () => {
  test("a runtime without variants is run once, with none", () => {
    expect(variantsToRun(undefined, true)).toEqual([null]);
    expect(variantsToRun([], false)).toEqual([null]);
  });
  test("all of them, or only the default", () => {
    expect(variantsToRun(COMPILER_VARIANTS, true).map((v) => v?.id)).toEqual([
      "compiler",
      "interpreter",
    ]);
    expect(variantsToRun(COMPILER_VARIANTS, false).map((v) => v?.id)).toEqual([
      "compiler",
    ]);
  });
});

describe("names", () => {
  test("the default variant keeps the plain file name", () => {
    expect(
      resultFileName("parity", "turbowarp", {
        id: "compiler",
        name: "compiler",
        default: true,
      }),
    ).toBe("parity-turbowarp.json");
    expect(
      resultFileName("parity", "turbowarp", {
        id: "interpreter",
        name: "interpreter",
        default: false,
      }),
    ).toBe("parity-turbowarp@interpreter.json");
    expect(resultFileName("performance", "scratch", null)).toBe(
      "performance-scratch.json",
    );
  });
  test("labels say which VM mode", () => {
    expect(
      labelOf("TurboWarp", {
        id: "interpreter",
        name: "interpreter",
        default: false,
      }),
    ).toBe("TurboWarp (interpreter)");
    expect(labelOf("Scratch", null)).toBe("Scratch");
  });
});

describe("withVariant", () => {
  test("adds the variant's environment to the command's", () => {
    const v: Variant = {
      id: "x",
      name: "x",
      default: false,
      env: { BENCH_COMPILER: "0" },
    };
    expect(withVariant({ cmd: ["a"], env: { A: "1" } }, v).env).toEqual({
      A: "1",
      BENCH_COMPILER: "0",
    });
    expect(withVariant({ cmd: ["a"] }, v).env!.BENCH_COMPILER).toBe("0");
    expect(withVariant({ cmd: ["a"] }, v).env!.PATH).toBe(
      String(process.env.PATH),
    );
  });
  test("leaves a command alone when there is nothing to add", () => {
    const c = { cmd: ["a"] };
    expect(withVariant(c, null)).toBe(c);
    expect(withVariant(c, { id: "x", name: "x", default: true })).toBe(c);
  });
});

describe("Scratch Everywhere! VM modes", () => {
  let dir: string;
  let sb3: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "se-vm-"));
    sb3 = path.join(dir, "p.sb3");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings =
    () => (fs.existsSync(`${sb3}.json`)
      ? JSON.parse(fs.readFileSync(`${sb3}.json`, "utf8"))
      : null);

  test("a build with the bytecode VM has both, and the bytecode VM is the default", () => {
    const [bytecode, interpreter] = vmVariants(true);
    expect([
      bytecode!.id,
      bytecode!.default,
      interpreter!.id,
      interpreter!.default,
    ]).toEqual(["bytecode", true, "interpreter", false]);
  });

  test("the interpreter is selected by the settings file next to the project, the bytecode VM by having none", () => {
    const [bytecode, interpreter] = vmVariants(true);
    interpreter!.prepare!(sb3);
    expect(settings()).toEqual({ settings: { useBytecode: false } });
    bytecode!.prepare!(sb3);
    expect(settings()).toBeNull();
  });

  test("a build from before the bytecode VM has only the interpreter, which is its default", () => {
    const only = vmVariants(false);
    expect(only.map((v) => [v.id, v.default])).toEqual([["interpreter", true]]);
    fs.writeFileSync(`${sb3}.json`, "{}");
    only[0]!.prepare!(sb3);
    expect(settings()).toBeNull();
  });
});
