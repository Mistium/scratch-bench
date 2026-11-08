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
   reads `2025-01-01T12:00:00Z` plus `f` frame intervals (1000 / the project's frame rate, 30 unless
   the runtime runs the project at another). It doesn't move within a frame.
2. The inputs recorded for frame `f` happen, in order, as they would from a person: key presses
   start key hats and hold the key; a press on a sprite starts its click hats; a draggable sprite
   is dragged once the pointer moves 3 or more units, or after 400 ms held; the wheel starts the
   up/down arrow key hats.
3. Exactly `passes[f]` passes run, whether or not the frame asks for a redraw, so every runtime does
   the same work (the recordings come from TurboWarp, and runtimes stop for redraws differently).
   Only a frame with no running threads left can stop sooner. A frame that makes a different
   number of passes than recorded counts as **drifted**.
4. Warp mode (run without screen refresh) and waiting behave as on an infinitely fast machine:
   loops never stop for time, and a block waiting on time or a condition yields at once, since
   nothing it waits on can change within a frame. A script that runs for 10 seconds without
   finishing (it would never finish) fails the replay with an error.
5. Random numbers come from a seeded generator, the same sequence every run.
6. Sound is off: nothing plays, and `play sound until done` doesn't wait.

Frames run back to back, as fast as the runtime can, but a replay may take no longer than the
recording did (the budget: `frames` at `framerate`, 10 seconds): once that much real time has passed
it stops after the current frame and reports the frames it got through. A frame still running 3
seconds after that is given up on, as an error, so no replay runs much past its recording's length.

## Output

One line, then `DONE`:

    <id> | <script ms> | <draw ms> | <wall ms> | <frames>/<recorded frames> | <drifted> | <hash> | <checkpoints>
    DONE

or `<id> | error | <message>` then `DONE`. Native runtimes print each line on stdout prefixed with
`[PROJECT] `.

- **script ms**: the runtime's own work for the frames: handling their inputs (starting hats,
  compiling) and stepping them. This is the speed the suite scores.
- **draw ms**: drawing the stage (only when asked to, see below) and waiting, after every frame, for
  the GPU to finish what the frame queued (pen lines and the like). Waiting every frame puts that
  work in the frame that made it; otherwise it piles up and is paid for by whatever next reads back
  from the GPU, or never.
- **wall ms**: real time for all the frames, without hashing.
- **checkpoints**: the script time so far at frames 1, 2, 3, 5, 8, 13, 20, 30, 50, 80, 120, 200, 300,
  500 and 800 (those reached), and at the last frame, as `frame:ms` separated by commas. A runtime is
  compared with another on the furthest checkpoint both reached, so on exactly the same frames.
- **hash**: 8 hex digits, a hash of the project's state (sprites, clones, variables and lists; a list
  over 10,000 items by its length and 1000 items spread across it) every 30 frames and at the end. It only has to be stable within a runtime: it is compared with the same
  runtime's earlier runs, and with other runtimes that share its implementation.

The stage needn't be drawn: nothing a project computes depends on drawing it (pen, touching and
touching color work without it), and in software WebGL it costs more than the frames. The browser
runners draw it only with `BENCH_REPLAY_DRAW=1`.

## Command line

A native runtime replays with:

    <runtime> <project.sb3> --replay <recording.json> --replay-id <id> --replay-budget <ms>

where the budget is the recording's length in milliseconds.
