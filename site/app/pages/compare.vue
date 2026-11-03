<script setup lang="ts">
const { data: meta } = await useMetaData();
useHead({ title: "Compare · ScratchBench" });
</script>

<template>
  <div class="page">
    <AppHeader />
    <main class="page__main">
      <EmptyState v-if="!meta || meta.runCount === 0" />
      <div v-else class="page__layout page__layout--flush">
        <div class="page__content">
          <CompareMap />
        </div>
        <RuntimeSidebar />
      </div>
    </main>
  </div>
</template>
