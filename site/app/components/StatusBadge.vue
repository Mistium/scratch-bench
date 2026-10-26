<script setup lang="ts">
import type { BenchStatus } from "#shared/types";

const { data: status, refresh } = await useFetch<BenchStatus>("/api/status", {
  key: "status",
});
const { data: meta } = await useMetaData();

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    if (status.value?.running || document.visibilityState === "visible") {
      refresh();
    }
  }, 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

const state = computed(
  () => (status.value?.running
    ? "running"
    : status.value?.lastRun && !status.value.lastRun.ok
    ? "failed"
    : "idle"),
);
</script>

<template>
  <div class="status-badge" :data-state="state" role="status">
    <template v-if="status?.running">
      <span class="status-badge__dot" />
      <span
        class="status-badge__text">Benchmark running since {{ fmtDateTime(status.startedAt) }}</span>
    </template>
    <template v-else>
      <span class="status-badge__dot" />
      <span class="status-badge__text">
        Data from {{ meta?.latest ? fmtAgo(meta.latest) : "never" }}
        <template v-if="status?.nextRun"> · next run {{ fmtDateTime(status.nextRun) }}</template>
      </span>
      <span v-if="status?.lastRun && !status.lastRun.ok"
        class="status-badge__warning" :title="status.lastRun.message">
        last run failed
      </span>
    </template>
  </div>
</template>
