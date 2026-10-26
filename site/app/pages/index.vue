<script setup lang="ts">
const { data: meta } = await useMetaData();
useHead({ title: "ScratchBench" });
</script>

<template>
  <div class="page">
    <AppHeader />

    <main class="page__main">
      <EmptyState v-if="!meta || meta.runCount === 0" />

      <template v-else>
        <section id="overview" class="overview"
          aria-labelledby="overview-title">
          <h2 id="overview-title" class="overview__title">Overview</h2>
          <div class="overview__grid">
            <Leaderboard />
            <CategoryScores />
          </div>
          <ScoreTrend />
          <ParityTrend />
          <MainBenchmarks />
          <div class="overview__grid">
            <ResourceUse />
            <ParitySummary />
          </div>
          <ScoringInfo />
        </section>

        <AdvancedExplorer />
      </template>
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
