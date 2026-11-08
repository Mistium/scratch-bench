<script setup lang="ts">
import type { ProjectResult } from "#shared/types";
import { projectTitle } from "#shared/projects";
import { projectSpeed, referenceFor } from "#shared/scoring";

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

// Every runtime's replays, including hidden ones, to find each project's reference.
const all = computed(() =>
  Object.fromEntries((latest.value?.projects ?? []).map((r) => [r.id, r.projects]))
);
const referenceName = (id: string) => {
  const ref = referenceFor(id, all.value);
  return (latest.value?.projects ?? []).find((r) => r.projects[id] === ref)?.name ?? null;
};
const speedOf = (id: string, p: ProjectResult | undefined) =>
  projectSpeed(p, referenceFor(id, all.value));

const cell = (id: string, p: ProjectResult | undefined) => {
  if (!p) return { text: "-", state: "missing" };
  if (p.error) return { text: "error", state: "error", title: p.error };
  if (!p.checkpoints) {
    // Older results, from replays in real time.
    return p.ms ? { text: fmtMs(p.ms.median), state: "ok", title: "real time (an older run)" } : { text: "-", state: "missing" };
  }
  const speed = speedOf(id, p);
  const scratch = all.value.scratch?.[id];
  const differs = !!scratch?.hash && !!p.hash && scratch.hash !== p.hash && !cut(p) && !cut(scratch);
  const notes = [
    `${fmtMs(p.script_ms?.median)} of scripts for ${p.frames} of ${p.recorded_frames} frames`,
    `${fmtMs(p.draw_ms?.median)} drawing`,
    speed !== null ? `compared with ${referenceName(id)} on the same frames` : "not comparable",
    p.drifted ? `${p.drifted} frames made a different number of passes than recorded` : "",
    differs ? "ended in a different state from Scratch" : "",
  ].filter(Boolean);
  return {
    text: `${differs ? "≠" : ""}${p.drifted ? "*" : ""}${speed !== null ? `${speed.toFixed(2)}×` : "-"}`,
    state: cut(p) ? "cut" : "ok",
    title: notes.join("; "),
  };
};

// Each runtime's projects score: the geometric mean of its speeds, as the overall score counts it.
const totals = computed(() =>
  runtimes.value.map((r) => {
    const speeds = Object.entries(r.projects)
      .map(([id, p]) => speedOf(id, p))
      .filter((x): x is number => x !== null);
    return {
      id: r.id,
      counted: speeds.length,
      total: Object.keys(r.projects).length,
      score: speeds.length ? Math.exp(speeds.reduce((n, x) => n + Math.log(x), 0) / speeds.length) : null,
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
        How fast each runtime runs the first 10 seconds of a recording of someone using each project, replayed frame by frame
        and the same in every runtime (like TurboWarp's pianola): its script time against TurboWarp's on exactly the same
        frames, so 0.5× is half as fast. A runtime that can't get through the recording in its 10 seconds is compared on
        the frames it did. ≠ ended in a different state from Scratch; * did different work from the recording.
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
            <th scope="row">Projects score</th>
            <td />
            <td v-for="t in totals" :key="t.id" class="projects__num">
              <template v-if="t.score !== null">{{ t.score.toFixed(2) }}×<template v-if="t.counted < t.total"> ({{ t.counted }}/{{ t.total }})</template></template>
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
