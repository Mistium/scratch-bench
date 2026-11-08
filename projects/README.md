# Projects

Real Scratch projects, each with a recording of a person using it, replayed as a benchmark (the
`projects` suite). The projects and recordings come from TurboWarp's
[pianola](https://github.com/TurboWarp/pianola) benchmark corpus; this suite uses 12 of them, the first
10 seconds of each:

- emulators: a Game Boy, a NES and a BBC Micro;
- simulations: Navier Stokes, Particle Lenia, the Game of Life and flow-field pathfinding;
- 3D: a renderer and an OBJ importer;
- games: Goopy, Bloons TD and Doom.

`manifest.json` lists them: id, title, author, and the SHA-256 of the project file the recording was
made with. `recordings/<id>.json` is the recorded play: its frame rate, how many passes the scheduler
made in each frame, and the inputs with the frame they happened before.

The project files aren't committed. The suite downloads them when it builds (not with `--offline`),
or `bun run fetch-projects` does, from the pinned copies pianola keeps
(`blobs.turbowarp.xyz/benchmarks/v1/<sha256>.sb3`), and checks each against its hash.

```sh
bun run bench --suite projects
```

## How a replay works

[REPLAY.md](REPLAY.md) is the protocol. In short, the project runs frame by frame, as fast as it can,
and each frame applies the inputs recorded for it and makes exactly the passes over the threads the
recording made, so every runtime does the same work. Time is a virtual clock that moves one frame per
frame, random numbers are seeded, sound is off, and waiting or running without screen refresh behaves
as on an infinitely fast machine. The stage isn't drawn (`BENCH_REPLAY_DRAW=1` draws it): nothing a
project computes depends on that, and in software WebGL it costs more than the frames.

Each replay reports:

- **script time**, the runtime's own work for the frames (handling the inputs and stepping them), at
  checkpoints through the replay;
- drawing time (the GPU finishing each frame's pen work and the like) and wall time;
- the frames it got through: a replay may take no longer than the recording did, 10 seconds, so a
  runtime that can't keep up gets through fewer;
- frames that made a different number of passes than recorded (**drifted**): those did different
  work, and a replay with more than 1% of them isn't scored;
- a hash of the project's state every 30 frames and at the end. The same runtime should always give
  the same hash, so a change between versions means it now computes something else; runtimes that
  share an implementation (everything in the browser runner) can be compared with Scratch too.

A runtime's speed on a project is TurboWarp's script time over its own (Scratch's when TurboWarp has
no replay of it) at the furthest checkpoint both reached, so they are always compared on exactly the
same frames: 0.5 is half as fast as TurboWarp. The overall score counts each project's speed as much
as two benchmarks.

Runtimes take part when their launcher can replay (`replay` in `src/runtimes/types.ts`): every
scratch-vm based runtime through the browser runner (`runtimes/chromium/index.html`), forkphorus
through its own page (`runtimes/forkphorus/bench.html`, which patches its frame loop as it serves it),
and oscratchl builds that have `--replay`. Any other native runtime takes part by implementing
`--replay` (REPLAY.md); the rest are skipped.

A run whose biggest process grows past 6 GB (`BENCH_MEMORY_LIMIT_MB`) is stopped and reported as an
error, so a runtime that leaks can't take the machine down with it.

Projects that wait for real time to pass within a frame can't be replayed this way, since time
stands still within a frame: Linux on a RISC-V emulator (pianola's corpus has it) runs each frame
until the clock shows 50 ms have passed, so no runtime gets past its first frame.

The projects are by their authors on scratch.mit.edu, shared under CC BY-SA 2.0.
