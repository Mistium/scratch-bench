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
  - `frames`: how many frames to replay.
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

Frames run back to back, as fast as the runtime can. The replay stops early when the real time
spent passes the budget (milliseconds); it then reports the frames it got through.

## Output

One line, then `DONE`:

    <id> | <script ms> | <draw ms> | <wall ms> | <frames>/<recorded frames> | <drifted> | <hash>
    DONE

or `<id> | error | <message>` then `DONE`. Native runtimes print each line on stdout prefixed with
`[PROJECT] `.

- **script ms**: time spent stepping frames, without drawing: the speed the suite scores.
- **draw ms**: time spent drawing the stage.
- **wall ms**: real time for all the frames, without hashing.
- **hash**: 8 hex digits, a hash of the project's state (sprites, clones, variables and lists) every
  30 frames and at the end. It only has to be stable within a runtime: it is compared with the same
  runtime's earlier runs, and with other runtimes that share its implementation.

## Command line

A native runtime replays with:

    <runtime> <project.sb3> --replay <recording.json> --replay-id <id> --replay-budget <ms>
