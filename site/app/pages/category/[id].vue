<script setup lang="ts">
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from "#shared/benchmarks";

const route = useRoute();
const id = String(route.params.id) as CategoryId;
if (!CATEGORY_IDS.includes(id)) {
  throw createError({
    statusCode: 404,
    statusMessage: "Unknown category",
    fatal: true,
  });
}
const category = CATEGORIES[id];
useHead({ title: `${category.label} · ScratchBench` });
</script>

<template>
  <div class="page">
    <AppHeader />
    <main class="page__main">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <NuxtLink to="/">Overview</NuxtLink>
        <span aria-hidden="true">/</span>
        <span>{{ category.label }}</span>
      </nav>

      <article class="benchmark-page">
        <header class="benchmark-page__header">
          <h1 class="benchmark-page__title">{{ category.label }}</h1>
          <p class="benchmark-page__text">{{ category.description }}</p>
          <p class="benchmark-page__meta">
            Each runtime's score is the geometric mean of this category's benchmarks, in operations per millisecond.
            <NuxtLink :to="{ path: '/', query: { cat: id }, hash: '#advanced' }">See its benchmarks</NuxtLink>
          </p>
        </header>
        <div class="benchmark-page__controls">
          <RuntimeChips />
        </div>
        <CategoryPanel :id="id" />
      </article>
    </main>
  </div>
</template>
