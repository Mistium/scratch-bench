import { describe, expect, test } from "bun:test";
import type { Runtime } from "../runtimes/types.ts";
import { pinHash, resolvePin } from "./resolve.ts";
import type { Source } from "./source.ts";

const calls: string[] = [];
const source: Source = {
  async gitHead(repo, date, { branch, paths }) {
    calls.push(
      `git ${repo} ${branch ?? "-"} ${(paths ?? []).join("+") || "-"} ${date}`,
    );
    if (repo === "Org/new-repo" && date < "2026-01-01") return null;
    return `${repo.replace(/\W/g, "").slice(-6)}@${date}`;
  },
  async npmVersion(pkg, date) {
    return date < "2025-09-01" ? null : `1.0.${date.slice(5, 7)}`;
  },
};

const fork: Runtime = {
  id: "fork",
  name: "Fork",
  kind: "node",
  setup: async () => ({ version: "x" }),
  history: {
    since: { performance: "2025-08-01", parity: "2026-03-01" },
    parts: [
      { git: "Org/vm", provides: { vm: "." } },
      { git: "Org/render", provides: { render: "." } },
      { npm: "@org/svg", provides: "svg" },
    ],
  },
};

const monorepo: Runtime = {
  ...fork,
  id: "mono",
  history: {
    since: { performance: "2025-08-01", parity: "2025-08-01" },
    parts: [{
      git: "Org/editor",
      branch: "develop",
      provides: { vm: "packages/vm", render: "packages/render" },
      shared: ["packages/shared"],
    }],
  },
};

describe("resolvePin", () => {
  test("parity pins every part, performance only the vm", async () => {
    const parity = await resolvePin(fork, "parity", "2026-05-01", source, {
      latest: false,
    });
    expect(parity?.parts.map((p) => p.provides)).toEqual([{ vm: "." }, {
      render: ".",
    }, "svg"]);
    const perf = await resolvePin(fork, "performance", "2026-05-01", source, {
      latest: false,
    });
    expect(perf?.parts.length).toBe(1);
    expect((perf!.parts[0] as { commit: string }).commit).toContain(
      "@2026-05-01",
    );
  });

  test("respects the per-suite start date", async () => {
    expect(
      await resolvePin(fork, "parity", "2026-02-28", source, { latest: false }),
    ).toBeNull();
    expect(
      await resolvePin(fork, "performance", "2026-02-28", source, {
        latest: false,
      }),
    ).not.toBeNull();
    expect(
      await resolvePin(fork, "performance", "2025-07-31", source, {
        latest: false,
      }),
    ).toBeNull();
  });

  test("a part that did not exist yet means the runtime cannot be pinned", async () => {
    const rt: Runtime = {
      ...fork,
      history: {
        since: { parity: "2025-08-01" },
        parts: [{ git: "Org/new-repo", provides: { vm: "." } }],
      },
    };
    expect(
      await resolvePin(rt, "parity", "2025-12-01", source, { latest: false }),
    ).toBeNull();
    expect(
      await resolvePin(rt, "parity", "2026-02-01", source, { latest: false }),
    ).not.toBeNull();
  });

  test("an npm part with nothing published yet also means no pin", async () => {
    expect(
      await resolvePin(fork, "parity", "2026-02-01", source, { latest: false }),
    ).toBeNull();
    const early: Runtime = {
      ...fork,
      history: { ...fork.history!, since: { parity: "2025-08-01" } },
    };
    expect(
      await resolvePin(early, "parity", "2025-08-15", source, {
        latest: false,
      }),
    ).toBeNull();
    expect(
      await resolvePin(early, "parity", "2025-09-15", source, {
        latest: false,
      }),
    ).not.toBeNull();
  });

  test("latestOnly suites resolve only on the latest date", async () => {
    const rt: Runtime = {
      ...fork,
      history: {
        ...fork.history!,
        since: { parity: "2025-08-01", performance: "2025-08-01" },
        latestOnly: ["parity"],
      },
    };
    expect(
      await resolvePin(rt, "parity", "2026-10-25", source, { latest: false }),
    ).toBeNull();
    expect(
      await resolvePin(rt, "parity", "2026-10-26", source, { latest: true }),
    ).not.toBeNull();
    expect(
      await resolvePin(rt, "performance", "2026-10-25", source, {
        latest: false,
      }),
    ).not.toBeNull();
  });

  test("a monorepo is pinned by the paths of the parts it provides plus its shared packages", async () => {
    calls.length = 0;
    await resolvePin(monorepo, "parity", "2026-05-01", source, {
      latest: false,
    });
    expect(calls.at(-1)).toBe(
      "git Org/editor develop packages/vm+packages/render+packages/shared 2026-05-01",
    );
    calls.length = 0;
    await resolvePin(monorepo, "performance", "2026-05-01", source, {
      latest: false,
    });
    expect(calls.at(-1)).toBe(
      "git Org/editor develop packages/vm+packages/shared 2026-05-01",
    );
  });

  test("a standalone fork is not path-filtered", async () => {
    calls.length = 0;
    await resolvePin(fork, "performance", "2026-05-01", source, {
      latest: false,
    });
    expect(calls).toEqual(["git Org/vm - - 2026-05-01"]);
  });

  test("runtimes without a history spec, or a suite it doesn't list, are skipped", async () => {
    const none: Runtime = { ...fork, history: undefined };
    expect(
      await resolvePin(none, "parity", "2026-05-01", source, { latest: false }),
    ).toBeNull();
    const perfOnly: Runtime = {
      ...fork,
      history: {
        since: { performance: "2025-08-01" },
        parts: fork.history!.parts,
      },
    };
    expect(
      await resolvePin(perfOnly, "parity", "2026-05-01", source, {
        latest: false,
      }),
    ).toBeNull();
  });

  test("custom resolvers are used as they are, still honouring since", async () => {
    const rt: Runtime = {
      ...fork,
      history: {
        since: { performance: "2026-01-01" },
        custom: {
          resolve: async (d) => ({ parts: [], custom: { date: d } }),
          build: async () => ({ command: () => ({ cmd: [] }) }),
        },
      },
    };
    expect(
      (await resolvePin(rt, "performance", "2026-02-01", source, {
        latest: false,
      }))?.custom,
    ).toEqual({ date: "2026-02-01" });
    expect(
      await resolvePin(rt, "performance", "2025-12-31", source, {
        latest: false,
      }),
    ).toBeNull();
  });
});

describe("pinHash", () => {
  const a = {
    parts: [{ git: "Org/vm", commit: "abc", provides: { vm: "." } }],
  };
  test("is stable and ignores key order", () => {
    const reordered = {
      parts: [{ provides: { vm: "." }, commit: "abc", git: "Org/vm" }],
    };
    expect(pinHash("r", "parity", a)).toBe(
      pinHash("r", "parity", reordered as typeof a),
    );
    expect(pinHash("r", "parity", a)).toHaveLength(16);
  });
  test("differs by runtime, suite and content", () => {
    const h = pinHash("r", "parity", a);
    expect(pinHash("s", "parity", a)).not.toBe(h);
    expect(pinHash("r", "performance", a)).not.toBe(h);
    expect(
      pinHash("r", "parity", { parts: [{ ...a.parts[0]!, commit: "abd" }] }),
    ).not.toBe(h);
  });
});
