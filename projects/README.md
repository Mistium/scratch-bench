# Projects

Real Scratch projects, each with a recording of a person using it, replayed as a benchmark (the
`projects` suite).

- `manifest.json` lists the projects: id, title, author, the sha256 of the `project.json` the
  recording belongs to, and `daily` for the short set the nightly run uses.
- `recordings/<id>.json` is the recorded play: the frame rate, the number of frames, how many
  scheduler ticks ran in each frame (`passes`), and the inputs with the frame they happened on
  (green flag, mouse, keys, wheel, `ask` answers, slider changes).

The projects themselves aren't committed. The suite downloads the ones it needs into
`.cache/projects` when it builds (not with `--offline`); to download them all ahead of time:

```sh
bun run fetch-projects            # all of them
bun run fetch-projects 1201938491 # just some
```

A project whose `project.json` no longer matches the manifest has been edited since it was recorded,
so it is skipped. The suite runs each runtime in its default mode only, not every variant, to keep the nightly
run short.

```sh
bun run bench --suite projects                    # the daily set: 10 recorded seconds of each, 30 s at most
bun run bench --suite projects --projects all     # every project, whole recordings, 5 minutes at most
bun run bench --suite projects --projects 1201938491,324569477
```

## How a replay works

`src/bake.ts` writes each recording into its project, so any runtime can replay it from the green
flag alone, with no browser and no way to send it input. It adds a sprite named "replay pointer"
on top of the others. That sprite's green-flag script plays the recorded events, a tick at a time,
and stands in for the mouse: a transparent 2px sprite at the recorded pointer position. The
project's input blocks are rewired to it:

- `mouse x`, `mouse y`, `mouse down?`, `key _ pressed?` and `answer` read what the pointer keeps;
- "mouse-pointer" in the touching, distance, go to, glide and point towards menus is the pointer;
- `when _ key pressed`, `when this sprite clicked` and `when stage clicked` are broadcasts the
  pointer sends (a click goes to the sprites under the pointer);
- `ask and wait` waits for the recorded answer;
- `stop all` stops every other script and deletes clones but leaves the replay running;
- slider changes the recording made set the variable.

Events are placed by tick, not by frame, so they reach the project at the same point in its run
however many ticks a runtime fits into each frame. Frames are paced as usual, at 30 fps for every
runtime (a TurboWarp frame rate or turbo setting is removed). A project that redraws every tick plays
in real time, so a runtime that keeps up takes about as long as the recording did, and one that
can't takes longer. A project that doesn't redraw runs as many ticks per frame as the runtime fits,
so a fast runtime can finish well ahead of the recording. A runtime with only a headless launcher
(rust-vm) has no renderer and may not pace frames at all, so its results are marked "(headless)"
and aren't comparable with the others.

A run whose biggest process grows past 6 GB (`BENCH_MEMORY_LIMIT_MB`) is stopped and
reported as an error, so a runtime that leaks can't take the machine down with it.

Each project reports how long the replay took, how many ticks it got through, the longest gap between
two ticks (its worst frame), how many frames took longer than 50 ms, and how long it took to load.

Some things are approximations, the same on every runtime:

- Real key and click hats leave a script that's still running alone; the broadcasts that replace
  them restart it. A key script that waits only starts on a fresh press (not on a held key's
  repeats), but pressing again while it runs restarts it, and a click restarts that sprite's
  running click scripts in its other clones.
- A click reaches every clickable sprite under the pointer, including fully ghosted ones, not just
  the top one. Dragging sprites isn't replayed.
- The pointer moving counts as a visual change, so it ends a frame where a real mouse move wouldn't.
- Turbo mode changes in a recording are ignored, and a recording stops at a second green flag.

The projects are by their authors on scratch.mit.edu, shared under CC BY-SA 2.0.
