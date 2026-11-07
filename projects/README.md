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
so it is skipped.

```sh
bun run bench --suite projects                    # the daily set: 10 seconds of each, a minute at most
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
however many ticks a runtime fits into each frame. The replay plays in real time, as a person would
see it. A runtime that keeps up takes about as long as the recording did, and one that can't takes
longer. Every runtime plays at 30 fps; a TurboWarp frame rate setting is removed.

The browser runners render with SwiftShader (software WebGL) by default, so every host draws the same
way; `BENCH_GPU=1` renders through Vulkan instead, which is many times faster for render-heavy
projects. A run whose biggest process grows past 6 GB (`BENCH_MEMORY_LIMIT_MB`) is stopped and
reported as an error, so a runtime that leaks can't take the machine down with it.

Each project reports how long the replay took, how many ticks it got through, the longest gap between
two ticks (its worst frame), how many frames took longer than 50 ms, and how long it took to load.

Some things are approximations. A held key's repeats restart a key script that finishes at once,
while a key script that waits only starts on the first press. A click reaches every clickable sprite
under the pointer, not just the top one. Dragging sprites isn't replayed.

The projects are by their authors on scratch.mit.edu, shared under CC BY-SA 2.0.
