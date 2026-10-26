<script setup lang="ts">
const props = defineProps<{ scope?: "trend" | "parity" }>();
const state = useBenchState();
const range = props.scope === "trend"
  ? state.trendRange
  : props.scope === "parity"
  ? state.parityRange
  : state.range;
const options = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
] as const;
</script>

<template>
  <div class="segmented" role="group" aria-label="Time range">
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      class="segmented__button"
      :data-state="range === o.id ? 'active' : 'idle'"
      :aria-pressed="range === o.id"
      @click="range = o.id"
    >
      {{ o.label }}
    </button>
  </div>
</template>
