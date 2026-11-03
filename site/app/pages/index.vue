<script setup lang="ts">
const { data: meta } = await useMetaData();
const { log } = useBenchState();
useHead({ title: "ScratchBench" });
</script>

<template>
  <div class="page">
    <AppHeader />

    <main class="page__main">
      <EmptyState v-if="!meta || meta.runCount === 0" />

      <div v-else class="page__layout">
        <div class="page__content">
          <section id="overview" class="overview"
            aria-labelledby="overview-title">
            <h2 id="overview-title" class="overview__title">Overview</h2>
            <label class="field field--check">
              <input v-model="log" type="checkbox" class="field__checkbox" />
              <span class="field__label">Logarithmic charts</span>
            </label>
            <div class="overview__grid">
              <Leaderboard />
              <CategoryScores />
            </div>
            <ScoreTrend />
            <ParityTrend />
            <ParitySummary />
            <MainBenchmarks />
            <ResourceUse />
            <ScoringInfo />
          </section>

          <AdvancedExplorer />
        </div>
        <RuntimeSidebar />
      </div>
    </main>

    <footer class="site-footer">
      <p class="site-footer__text">
        {{ meta?.runCount ?? 0 }} runs recorded<template v-if="meta?.latest">, latest {{ fmtDateTime(meta.latest) }}</template>.
      </p>
      <details v-if="meta?.warnings.length" class="site-footer__warnings">
        <summary>{{ meta.warnings.length }} result file{{ meta.warnings.length > 1 ? "s were" : " was" }} skipped</summary>
        <ul>
          <li v-for="w in meta.warnings" :key="w">{{ w }}</li>
        </ul>
      </details>
    </footer>
  </div>
</template>
