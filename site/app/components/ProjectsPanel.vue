<script setup lang="ts">
import type { ProjectResult } from "#shared/types";
import { projectTitle } from "#shared/projects";

const titleOf = (id: string) =>
  runtimes.value.map((r) => r.projects[id]?.title).find(Boolean) ?? projectTitle(id);

const { host } = useBenchState();
const { data: latest } = await useLatestData(host);
const shown = useShown();

const runtimes = computed(() =>
  (latest.value?.projects ?? []).filter((r) => shown(r.id))
);
const ids = computed(() => [
  ...new Set(runtimes.value.flatMap((r) => Object.keys(r.projects))),
]);
const recordedFrames = (id: string) =>
  runtimes.value.map((r) => r.projects[id]?.recorded_frames).find((x) => typeof x === "number") ?? null;

const cut = (p: ProjectResult) =>
  p.frames != null && p.recorded_frames != null && p.frames < p.recorded_frames;

/**
 * Script time for the whole recording: measured when the replay finished, scaled up from the
 * frames it reached when it ran out of time.
 */
const scriptMs = (p: ProjectResult | undefined): number | null =>
  p && !p.error && p.script_ms && p.frames && p.recorded_frames
    ? p.script_ms.median * (p.recorded_frames / p.frames)
    : null;

// Scratch's own result, for spotting runtimes that computed something else.
const scratch = computed(() => latest.value?.projects?.find((r) => r.id === "scratch"));

const cell = (id: string, p: ProjectResult | undefined) => {
  if (!p) return { text: "-", state: "missing" };
  if (p.error) return { text: "error", state: "error", title: p.error };
  const script = scriptMs(p);
  if (script === null) {
    // Older results, from replays in real time.
    return p.ms ? { text: fmtMs(p.ms.median), state: "ok", title: "real time (an older run)" } : { text: "-", state: "missing" };
  }
  const base = scratch.value?.projects[id];
  const differs = !!base?.hash && !!p.hash && base.hash !== p.hash && !cut(p) && !cut(base);
  const notes = [
    `${fmtMs(p.draw_ms?.median)} drawing, ${fmtMs(p.wall_ms?.median)} in all`,
    cut(p) ? `ran out of time at frame ${p.frames} of ${p.recorded_frames}, so this is scaled up` : "",
    p.drifted ? `${p.drifted} frames made a different number of passes than recorded` : "",
    differs ? "ended in a different state from Scratch" : "",
  ].filter(Boolean);
  return {
    text: `${differs ? "≠" : ""}${p.drifted ? "*" : ""}${cut(p) ? "~" : ""}${fmtMs(script)}`,
    state: cut(p) ? "cut" : "ok",
    title: notes.join("; "),
  };
};

const totals = computed(() =>
  runtimes.value.map((r) => {
    const all = Object.values(r.projects);
    const timed = all.map(scriptMs).filter((x): x is number => x !== null);
    return {
      id: r.id,
      timed: timed.length,
      total: all.length,
      ms: timed.reduce((n, x) => n + x, 0),
    };
  })
);
</script>

<template>
  <section v-if="runtimes.length" class="panel projects"
    aria-labelledby="projects-title">
    <header class="panel__header">
      <h2 id="projects-title" class="panel__title">Real projects</h2>
      <p class="panel__subtitle">
        Script time to replay the start of a recording of someone using each project, frame by frame and the same in every
        runtime (like TurboWarp's pianola): the time spent running the project's scripts, without drawing. Lower is faster.
        ~ scaled up from a replay that ran out of time; ≠ ended in a different state from Scratch; * did different work from
        the recording. Hover a cell for drawing and total time.
      </p>
    </header>

    <div class="projects__scroll">
      <table class="projects__table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col" class="projects__num">Frames</th>
            <th v-for="r in runtimes" :key="r.id" scope="col"
              class="projects__num">
              <span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}<template
                v-if="r.launcher === 'headless'"> (headless)</template>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="id in ids" :key="id">
            <th scope="row">{{ titleOf(id) }}</th>
            <td class="projects__num">{{ recordedFrames(id) ?? "-" }}</td>
            <td v-for="r in runtimes" :key="r.id" class="projects__num"
              :data-state="cell(id, r.projects[id]).state"
              :title="cell(id, r.projects[id]).title ?? undefined">
              {{ cell(id, r.projects[id]).text }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total script time</th>
            <td />
            <td v-for="t in totals" :key="t.id" class="projects__num">
              <template v-if="t.timed">{{ fmtMs(t.ms) }}<template v-if="t.timed < t.total"> ({{ t.timed }}/{{ t.total }})</template></template>
              <template v-else>-</template>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="parity__note">
      Only runtimes that can replay a recording frame by frame (projects/REPLAY.md in the repository) take part.
    </p>
  </section>
</template>
