<script setup lang="ts">
import { BENCHMARK_BY_ID, CATEGORIES } from "#shared/benchmarks";

const route = useRoute();
const id = String(route.params.id);
const bench = BENCHMARK_BY_ID[id];
if (!bench) {
  throw createError({
    statusCode: 404,
    statusMessage: "Unknown benchmark",
    fatal: true,
  });
}

const { tab } = useBenchState();
useHead({ title: `${bench.label} · ScratchBench` });
</script>

<template>
  <div class="page">
    <AppHeader />
    <main class="page__main">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <NuxtLink to="/">Overview</NuxtLink>
        <span aria-hidden="true">/</span>
        <NuxtLink
          :to="{ path: '/', query: { cat: bench.category }, hash: '#advanced' }">{{ CATEGORIES[bench.category].label }}</NuxtLink>
      </nav>

      <article class="benchmark-page">
        <header class="benchmark-page__header">
          <h1 class="benchmark-page__title">{{ bench.label }}</h1>
          <p class="benchmark-page__text">{{ bench.description }}</p>
          <p class="benchmark-page__meta">
            <code>{{ bench.id }}</code> · one operation is one {{ bench.unit.replace(/s$/, "") }}
          </p>
        </header>
        <div class="benchmark-page__controls">
          <RuntimeChips />
          <ModeToggle />
        </div>
        <BenchmarkPanel :id="bench.id" :initial-tab="tab" />
      </article>
    </main>
  </div>
</template>
