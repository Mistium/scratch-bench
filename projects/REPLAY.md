# Replay protocol

How a runtime replays a recording for the `projects` suite. It follows TurboWarp's
[pianola](https://github.com/TurboWarp/pianola) benchmark, where the recordings come from, so that
every runtime does the same work however fast it is, and a runtime that gets faster by computing
something different shows up.

A runtime supports the suite by implementing this. The browser runner (`runtimes/chromium/index.html`,
`replay`) implements it for every scratch-vm based runtime; a native runtime takes it on its command
line.

## Input

- The project file, as pinned in `manifest.json` (by its SHA-256).
- The recording, `recordings/<id>.json`:
  - `framerate`: the frame rate it was recorded at, and `frames`: how many frames to replay. Every
    recording here is 10 seconds long.
  - `passes[f]`: how many passes over the threads frame `f` made when it was recorded. A pass steps
    every running thread until it yields.
  - `inputs`: what happened, each with the `frame` it happened before:
    - `{"type": "greenFlag"}`, `{"type": "stop"}`, `{"type": "turbo", "on": true}`
    - `{"type": "key", "key": "ArrowLeft", "keyCode": 37, "down": true}`: `key` is the browser's
      `KeyboardEvent.key`.
    - `{"type": "mouse", "x": 12.5, "y": -40}`: the pointer moved, in stage coordinates (it can be
      off the stage). With `"down": true|false` and `"button": 0` it was pressed or released there.
    - `{"type": "wheel", "dx": 0, "dy": -100}`
    - `{"type": "answer", "text": "..."}`: the answer to the open `ask`.
    - `{"type": "variable", "target": null, "id": "...", "value": 5}`: a slider set a variable, on
      the stage (`target` null) or the sprite of that name.

## Each frame

For frame `f` from 0 to `frames - 1`:

1. The project's clock (`timer`, `days since 2000`, `current`, and the time `wait` and `glide` go by)
   reads `2025-01-01T12:00:00Z` plus `f` frame intervals (1000 / the recording's `framerate`). It
   doesn't move within a frame.
2. The inputs recorded for frame `f` happen, in order, as they would from a person: key presses
   start key hats and hold the key; a press on a sprite starts its click hats; a draggable sprite
   is dragged once the pointer moves more than 3 units, or after 400 ms held; the wheel starts the
   up/down arrow key hats.
3. Exactly `passes[f]` passes run, whether or not the frame asks for a redraw, so every runtime does
   the same work (the recordings come from TurboWarp, and runtimes stop for redraws differently).
   Only a frame with no running threads left can stop sooner. A frame that makes a different
   number of passes than recorded counts as **drifted**.
4. Warp mode (run without screen refresh) and waiting behave as on an infinitely fast machine:
   loops never stop for time, and a block waiting on time or a condition yields at once, since
   nothing it waits on can change within a frame. A script that would never finish holds up its
   frame until the replay is cut (below).
5. Random numbers come from a seeded generator, the same sequence every run.
6. Sound is off: nothing plays, and `play sound until done` doesn't wait.

Frames run back to back, as fast as the runtime can, but a replay may take no longer than the
recording did (the budget: `frames` at `framerate`, 10 seconds). Once that much real time has passed
since the first frame began (hashing included), it stops after the current frame and reports the
frames it got through. So the GPU's time and the browser's take frames from a runtime too; it is
still scored on script time, on frames another runtime also got through.

A frame still running 3 seconds after the budget is **cut**: the replay stops there and reports the
frames up to its last checkpoint, with the hash `unfinished`, and the next checkpoint (frame 1 if it
had reached none) at its script time so far plus 3 seconds. That frame began before the budget ran
out and has run ever since, so the runtime would have reached that checkpoint no sooner: compared
there, it does no worse than it deserves, rather than being left out, which would score it only on
the projects it can manage. A checkpoint past the frames reached is always such a bound.

## Output

One line, then `DONE`:

    <id> | <script ms> | <draw ms> | <frame ms> | <frames>/<recorded frames> | <drifted> | <hash> | <checkpoints>
    DONE

or `<id> | error | <message>` then `DONE`. Native runtimes print each line on stdout prefixed with
`[PROJECT] `.

- **frame ms**: real time for all the frames, from the first to the end of the last, without
  hashing: everything it took to get through them. The budget counts this.
- **script ms**: of that, the runtime's own work: handling the frames' inputs (starting hats,
  compiling) and stepping them. This is the speed the suite scores. The rest is mostly the GPU,
  which in the browser runners is SwiftShader (software, the same for every scratch-vm runtime) and
  for a headless native runtime is nothing, so counting it would blur the runtimes' differences.
- **draw ms**: of that, drawing the stage (only when asked to, see below) and waiting, after every
  frame, for the GPU to finish what the frame queued (pen lines and the like). Waiting every frame
  puts that work in the frame that made it; otherwise it piles up and is paid for by whatever next
  reads back from the GPU, or never.
- **checkpoints**: the script time so far at frames 1, 2, 3, 5, 8, 13, 20, 30, 50, 80, 120, 200, 300,
  500 and 800 (those reached), and at the last frame, as `frame:ms` separated by commas (and a cut
  replay's bound). A runtime is compared with another on the furthest checkpoint both reached, so on
  exactly the same frames; a reference's bound isn't used.
- **hash**: 8 hex digits, a hash of the project's state (sprites, clones, variables and lists; a list
  over 10,000 items by its length and 1000 items spread across it) every 30 frames and at the end.
  It only has to be stable within a runtime: it is compared with the same runtime's earlier runs,
  and with other runtimes whose replays hash the same way (the launcher's `replayHash`: every
  scratch-vm runtime in the browser runner shares one).

The stage needn't be drawn: nothing a project computes depends on drawing it (pen, touching and
touching color work without it), and in software WebGL it costs more than the frames. The browser
runners draw it only with `BENCH_REPLAY_DRAW=1`.

## Command line

A native runtime replays with:

    <runtime> <project.sb3> --replay <recording.json> --replay-id <id> --replay-budget <ms>

where the budget is the recording's length in milliseconds.
