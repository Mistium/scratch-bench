import { forkStack, gitPinnedVersion, nodeVmRuntime } from "./node-vm.ts";

// ClipCC (Clipteam): a scratch-vm fork popular in China. No compiler, so it has only the interpreter mode.
export const clipcc = nodeVmRuntime(
  "clipcc",
  "ClipCC",
  async () => {
    const { version, commit } = await gitPinnedVersion("clipcc-vm");
    return { version, detail: { "vm-commit": commit, repo: "Clipteam/clipcc-vm" } };
  },
  {
    web: async () => forkStack("clipcc", { svg: true, storage: true }),
    history: {
      // Its "init" commit, the first not in Scratch's history.
      since: { performance: "2019-12-29", parity: "2019-12-29" },
      fallback: 5,
      parts: [
        { git: "Clipteam/clipcc-vm", provides: { vm: "." } },
        // Stock Scratch packages as each date had them (prereleases included) until ClipCC forked or froze them; they
        // have since moved on to incompatible majors.
        { npm: "scratch-render", provides: "render", until: "2021-09-11", prerelease: true },
        { git: "Clipteam/clipcc-render", provides: { render: "." }, since: "2021-09-12" },
        { npm: "scratch-storage", provides: "storage", until: "2022-05-24", prerelease: true },
        { npm: "scratch-storage", provides: "storage", since: "2022-05-25", version: "2.0.2" },
        { npm: "scratch-svg-renderer", provides: "svg", until: "2022-09-11", prerelease: true },
        { npm: "scratch-svg-renderer", provides: "svg", since: "2022-09-12", version: "0.2.0-prerelease.20220912180225" },
        { npm: "scratch-audio", provides: "audio", until: "2020-05-27", prerelease: true },
        { npm: "scratch-audio", provides: "audio", since: "2020-05-28", version: "0.1.0-prerelease.20200528195344" },
      ],
    },
  },
);
