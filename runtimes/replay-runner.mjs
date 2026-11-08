// What the browser runners (chromium-vm.mjs, forkphorus.mjs) share when they replay a recording.
import fs from "fs";

/** How long a frame may still run after the budget before the replay is cut there. */
export const LATE_MS = 3_000;

const ms = (x) => Math.round(x * 10) / 10;

/**
 * Replays in the page with `run` (which calls its `window.replay`) and prints the result line and
 * DONE.
 *
 * The page checks its budget between frames, so a frame that doesn't end (a script that would never
 * finish, or one a runtime is too slow to finish) would keep it going past the recording's length.
 * LATE_MS after the budget, counted from the first frame, the replay is cut in that frame: it
 * reports the frames before it, and that frame as finished no sooner than LATE_MS more of script
 * time later. The frame started before the budget ran out and has run since, so that is a bound
 * the runtime would only have done worse than, on any frame from that one on: compared there, it
 * is scored no lower than it deserves, rather than left out (which would score it on only the
 * projects it can manage). See projects/REPLAY.md.
 */
export const replayInPage = async (page, { recording, replayId, budgetMs }, run) => {
  const recorded = JSON.parse(fs.readFileSync(recording, "utf8")).frames;
  const marks = [];
  // The frame being run, with the script time and drift before it.
  let current = { frame: 0, scriptMs: 0, drawMs: 0, drifted: 0 };
  let stuck;
  page.on("console", (m) => {
    const text = m.text();
    if (!text.startsWith("[REPLAY] ")) return;
    const [kind, ...rest] = text.slice("[REPLAY] ".length).split(" ");
    if (kind === "frame") {
      const [frame, scriptMs, drawMs, drifted] = rest.map(Number);
      current = { frame, scriptMs, drawMs, drifted };
    } else if (kind === "checkpoint") {
      const [frame, , scriptMs] = rest.map(Number);
      marks.push(`${frame}:${ms(scriptMs)}`);
    } else if (kind === "frames" && rest[0] === "end") {
      clearTimeout(stuck);
    } else if (kind === "frames" && rest[0] === "start") {
      stuck = setTimeout(() => {
        const { frame, scriptMs, drawMs, drifted } = current;
        const bound = `${frame + 1}:${ms(scriptMs + LATE_MS)}`;
        console.log(
          `[PROJECT] ${replayId} | ${ms(scriptMs + LATE_MS)} | ${ms(drawMs)} | ${ms(budgetMs + LATE_MS)} | ${frame}/${recorded} | ${drifted} | unfinished | ${[...marks, bound].join(",")}`,
        );
        console.log("[PROJECT] DONE");
        process.exit(1);
      }, budgetMs + LATE_MS);
    }
  });
  const line = await run().catch((e) => `${replayId} | error | ${String(e.message).split("\n")[0]}`);
  clearTimeout(stuck);
  console.log(`[PROJECT] ${line}`);
  console.log("[PROJECT] DONE");
};
