<script setup lang="ts">
import type { ProjectResult } from "#shared/types";
import { projectTitle } from "#shared/projects";

const { host } = useBenchState();
const { data: latest } = await useLatestData(host);
const shown = useShown();

const runtimes = computed(() =>
  (latest.value?.projects ?? []).filter((r) => shown(r.id))
);
const ids = computed(() => [
  ...new Set(runtimes.value.flatMap((r) => Object.keys(r.projects))),
]);
const recorded = (id: string) =>
  runtimes.value.map((r) => r.projects[id]?.recorded_ms).find((x) =>
    typeof x === "number"
  ) ?? null;

const cut = (p: ProjectResult) =>
  p.ticks !== null && p.recorded_ticks !== null && p.ticks < p.recorded_ticks;

const cell = (p: ProjectResult | undefined) => {
  if (!p) return { text: "-", state: "missing" };
  if (p.error || !p.ms) return { text: "error", state: "error", title: p.error };
  if (cut(p)) {
    return {
      text: `${p.ticks}/${p.recorded_ticks} ticks`,
      state: "cut",
      title: "Ran out of time before the recording ended",
    };
  }
  return {
    text: fmtMs(p.ms.median),
    state: "ok",
    title: p.long_frames ? `${p.long_frames} frames took longer than 50 ms` : undefined,
  };
};

const totals = computed(() =>
  runtimes.value.map((r) => {
    const all = Object.values(r.projects);
    const done = all.filter((p) => !p.error && p.ms && !cut(p));
    return {
      id: r.id,
      full: done.length,
      total: all.length,
      ms: done.reduce((n, p) => n + p.ms!.median, 0),
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
        Time to replay the first 10 seconds of a recording of someone using each project. A runtime that keeps up takes about
        the recorded time; slower ones take longer, and one that runs out of time shows how many ticks it reached.
      </p>
    </header>

    <div class="projects__scroll">
      <table class="projects__table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col" class="projects__num">Recorded</th>
            <th v-for="r in runtimes" :key="r.id" scope="col"
              class="projects__num">
              <span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}<template
                v-if="r.launcher === 'headless'"> (headless)</template>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="id in ids" :key="id">
            <th scope="row">{{ projectTitle(id) }}</th>
            <td class="projects__num">{{ fmtMs(recorded(id)) }}</td>
            <td v-for="r in runtimes" :key="r.id" class="projects__num"
              :data-state="cell(r.projects[id]).state"
              :title="cell(r.projects[id]).title ?? undefined">
              {{ cell(r.projects[id]).text }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Replayed in full</th>
            <td />
            <td v-for="t in totals" :key="t.id" class="projects__num">
              {{ t.full }}/{{ t.total }}<template v-if="t.full">, {{ fmtMs(t.ms) }}</template>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="parity__note">
      Headless runtimes have no renderer and may not pace frames, so they are not comparable with the others.
    </p>
  </section>
</template>
