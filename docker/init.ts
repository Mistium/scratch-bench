import fs from "node:fs";
import path from "node:path";
import { acquireLock } from "../src/lock.ts";
import { CACHE } from "../src/paths.ts";

const MARKER = path.join(CACHE, "backfill", "initial-backfill.done");
const mode = (process.env.BACKFILL ?? "auto").toLowerCase();
const log = (line: string) => console.log(`[init] ${line}`);

let child: ReturnType<typeof Bun.spawn> | undefined;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    child?.kill(sig);
    process.exit(143);
  });
}

const run = async (title: string, cmd: string[]): Promise<number> => {
  log(`${title}: ${cmd.join(" ")}`);
  child = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  child = undefined;
  log(`${title} finished with status ${code}`);
  return code;
};

const main = async () => {
  if (!["auto", "always", "off"].includes(mode)) {
    throw new Error(`BACKFILL must be auto, always or off (got "${mode}")`);
  }
  if (mode === "off") return log("BACKFILL=off: nothing to do");
  if (mode === "auto" && fs.existsSync(MARKER)) {
    return log("the initial backfill already completed: nothing to do");
  }

  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    log(
      "warning: GH_TOKEN is not set. GitHub allows 60 unauthenticated API calls an hour and no artifact downloads, so",
    );
    log(
      "         resolving versions will be rate limited and Scratch Everywhere! builds will be compiled from source.",
    );
  }

  const release = acquireLock();
  if (!release) {
    return log("another benchmark job holds the run lock: not starting");
  }
  try {
    await run("setup", ["bun", "src/cli.ts", "setup"]);

    const extra = (process.env.BACKFILL_ARGS ?? "").split(/\s+/).filter(
      Boolean,
    );
    const code = await run("backfill", [
      "bun",
      "src/backfill/cli.ts",
      ...extra,
    ]);
    if (code === 0 || code === 3) {
      const partial = extra.some((a) =>
        ["--limit", "--from", "--to", "--runtime", "--suite", "--dry-run"]
          .includes(a)
      );
      if (!partial) {
        fs.mkdirSync(path.dirname(MARKER), { recursive: true });
        fs.writeFileSync(MARKER, `${new Date().toISOString()}\n`);
        log("initial backfill complete");
      } else {
        log(
          "BACKFILL_ARGS limited the backfill, so it will run again on the next start",
        );
      }
    } else {
      log("the backfill did not finish; it resumes on the next start");
    }
  } finally {
    release();
  }
};

main().catch((e) => {
  console.error(`[init] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
