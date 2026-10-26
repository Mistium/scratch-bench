<script setup lang="ts">
import { MAIN_BENCHMARKS } from "#shared/benchmarks";

const { host, baseline, mainMode: mode } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf } = useRuntimes(meta, baseline);
const { value, text } = useValues(latest, baseline, mode);

const runtimeIds = computed(() =>
  (latest.value?.runtimes ?? []).map((r) => r.id)
);

const cards = computed(() =>
  MAIN_BENCHMARKS.map((b) => {
    const entries = runtimeIds.value
      .map((id) => ({
        id,
        name: nameOf(id),
        v: value(id, b.id),
        text: text(id, b.id),
      }))
      .sort((a, c) => (c.v ?? -1) - (a.v ?? -1));
    const vals = entries.map((e) => e.v).filter((v): v is number =>
      v != null && v > 0
    );
    const lo = Math.log(Math.min(...vals));
    const hi = Math.log(Math.max(...vals));
    // Position on a log scale between the slowest and fastest runtime, so a 300x gap still shows the small ones.
    const position = (v: number | null) => (v == null || v <= 0
      ? 0
      : hi === lo
      ? 1
      : 0.04 + 0.96 * ((Math.log(v) - lo) / (hi - lo)));
    return {
      bench: b,
      entries: entries.map((e) => ({ ...e, position: position(e.v) })),
    };
  })
);
</script>

<template>
  <section class="panel main-benchmarks" aria-labelledby="main-title">
    <header class="panel__header">
      <h2 id="main-title" class="panel__title">Main benchmarks</h2>
      <ModeToggle scope="main" />
    </header>
    <p
      class="panel__subtitle">Whole programs and the scheduler, the closest to how projects really run. Bars use a logarithmic scale.</p>

    <div class="card-grid">
      <article v-for="c in cards" :key="c.bench.id" class="bench-card">
        <header class="bench-card__header">
          <h3 class="bench-card__title">
            <NuxtLink
              :to="{ path: `/benchmark/${c.bench.id}`, query: { mode, baseline: baseline === 'scratch' ? undefined : baseline } }">{{ c.bench.label }}</NuxtLink>
          </h3>
          <p class="bench-card__text">{{ c.bench.description }}</p>
        </header>
        <ul class="bar-list">
          <li v-for="(e, i) in c.entries" :key="e.id" class="bar-list__item"
            :data-runtime="e.id" :data-best="i === 0">
            <span
              class="bar-list__name"><span class="runtime-dot" :data-runtime="e.id" /> {{ e.name }}</span>
            <meter class="bar-list__bar" :data-runtime="e.id" min="0" max="1"
              :value="e.position" :aria-label="`${e.name}: ${e.text}`" />
            <span class="bar-list__value">{{ e.text }}</span>
          </li>
        </ul>
        <p v-if="mode === 'absolute'"
          class="bench-card__unit">{{ c.bench.unit }} per ms</p>
      </article>
    </div>
  </section>
</template>
