<script setup lang="ts">
const { host, baseline, weights, hidden } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf } = useRuntimes(meta, baseline);

const ranked = useRankedRuntimeIds(host, weights);
const ids = computed(() => {
  const present = (latest.value?.runtimes ?? []).map((r) => r.id);
  return [
    ...ranked.value.filter((id) => present.includes(id)),
    ...present.filter((id) => !ranked.value.includes(id)),
  ];
});

const toggle = (id: string) => {
  hidden.value = hidden.value.includes(id)
    ? hidden.value.filter((x) => x !== id)
    : [...hidden.value, id];
};
</script>

<template>
  <div class="chips" role="group" aria-label="Runtimes shown">
    <button
      v-for="id in ids"
      :key="id"
      type="button"
      class="chip"
      :data-runtime="id"
      :data-state="hidden.includes(id) ? 'idle' : 'active'"
      :aria-pressed="!hidden.includes(id)"
      @click="toggle(id)"
    >
      <span class="runtime-dot" :data-runtime="id" /> {{ nameOf(id) }}
    </button>
  </div>
</template>
