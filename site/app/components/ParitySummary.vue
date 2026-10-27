<script setup lang="ts">
const { host, baseline } = useBenchState();
const { data: latest } = await useLatestData(host);

const rows = computed(() =>
  (latest.value?.parity ?? [])
    .map((r) => {
      const p = r.parity;
      const ratio = p && p.total ? (p.passed ?? 0) / p.total : null;
      return { id: r.id, name: r.name, parity: p, ratio };
    })
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
);
</script>

<template>
  <section class="panel parity" aria-labelledby="parity-title">
    <header class="panel__header">
      <h2 id="parity-title" class="panel__title">Parity</h2>
      <p class="panel__subtitle">
        How many of the scratch-parity checks each runtime passes, run with a real renderer. The tests are written against
        official Scratch.
      </p>
    </header>

    <ul class="parity__list">
      <li v-for="r in rows" :key="r.id" class="parity__item"
        :data-runtime="r.id"
        :data-state="r.parity ? r.parity.verdict : 'missing'">
        <details class="parity__details">
          <summary class="parity__summary">
            <span
              class="parity__name"><span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}</span>
            <template v-if="r.parity">
              <meter class="parity__bar" :data-runtime="r.id" min="0" max="1"
                :value="r.ratio ?? 0" :aria-label="`${r.name} parity`" />
              <span
                class="parity__score">{{ r.parity.passed }} / {{ r.parity.total }} ({{ fmtPercent(r.ratio) }})</span>
            </template>
            <span v-else class="parity__score">did not complete</span>
          </summary>
          <div class="parity__body">
            <p v-if="!r.parity"
              class="parity__note">This runtime did not finish the parity run, so it has no result.</p>
            <p v-else-if="!r.parity.failed_groups.length"
              class="parity__note">Every test passed.</p>
            <ul v-else class="parity__groups">
              <li v-for="g in r.parity.failed_groups" :key="g.name"
                class="parity__group">
                <span class="parity__group-name">{{ g.name }}</span>
                <span
                  class="parity__group-score">{{ g.passed }} / {{ g.total }}</span>
              </li>
            </ul>
            <p v-if="r.parity?.stale"
              class="parity__note">From {{ fmtDate(r.parity.timestamp) }}; a newer parity run is missing this runtime.</p>
          </div>
        </details>
      </li>
    </ul>
  </section>
</template>
