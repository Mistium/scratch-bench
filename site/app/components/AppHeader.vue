<script setup lang="ts">
const { data: meta } = await useMetaData();
const { host, baseline, weights } = useBenchState();
const { ordered } = useRuntimes(meta, baseline);

const effectiveHost = computed(() =>
  host.value || meta.value?.hosts[0]?.id || ""
);
</script>

<template>
  <header class="site-header">
    <div class="site-header__top">
      <div class="site-header__title">
        <NuxtLink to="/" class="site-header__home">ScratchBench</NuxtLink>
        <span v-if="meta?.demo" class="badge" data-kind="demo">Demo data</span>
      </div>
      <div class="site-header__meta">
        <StatusBadge />
        <ThemeToggle />
      </div>
    </div>

    <div class="site-header__controls">
      <label v-if="meta && meta.hosts.length > 1" class="field">
        <span class="field__label">Machine</span>
        <select class="field__select" :value="effectiveHost"
          @change="host = ($event.target as HTMLSelectElement).value">
          <option v-for="h in meta.hosts" :key="h.id"
            :value="h.id">{{ h.label }} ({{ h.runs }} runs)</option>
        </select>
      </label>

      <label class="field">
        <span class="field__label"
          title="Speedup columns and charts are shown relative to this runtime. Scores do not depend on it.">Speedups relative to</span>
        <select v-model="baseline" class="field__select">
          <option v-for="r in ordered" :key="r.id"
            :value="r.id">{{ r.name }}</option>
        </select>
      </label>

      <label class="field field--check">
        <input
          type="checkbox"
          class="field__checkbox"
          :checked="weights === 'default'"
          @change="weights = ($event.target as HTMLInputElement).checked ? 'default' : 'equal'"
        />
        <span class="field__label">Weight real-world tests higher</span>
      </label>
    </div>
  </header>
</template>
