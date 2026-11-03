<script setup lang="ts">
import { GitBranch, RotateCcw } from "lucide-vue-next";

const { host, baseline, weights, hidden, modes } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf } = useRuntimes(meta, baseline);
const ranked = useRankedRuntimeIds(host, weights);

const query = ref("");
const search = ref<HTMLInputElement | null>(null);

const ids = computed(() => {
  const present = (latest.value?.runtimes ?? []).map((r) => r.id).filter((id) =>
    !id.includes("~")
  );
  return [
    ...ranked.value.filter((id) => present.includes(id)),
    ...present.filter((id) => !ranked.value.includes(id)),
  ];
});
const listed = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q
    ? ids.value.filter((id) => nameOf(id).toLowerCase().includes(q))
    : ids.value;
});
const shownCount = computed(() =>
  ids.value.filter((id) => !hidden.value.includes(id)).length
);

const runtimeOf = (id: string) =>
  latest.value?.runtimes.find((r) => r.id === id);
const hasModes = (id: string) => !!runtimeOf(id)?.variant;
const modesOf = (id: string) =>
  modes.value.includes(id)
    ? (latest.value?.runtimes ?? []).filter((r) => r.base === id && r.id !== id)
    : [];

const toggle = (id: string) => {
  hidden.value = hidden.value.includes(id)
    ? hidden.value.filter((x) => x !== id)
    : [...hidden.value, id];
};
const solo = (id: string) => {
  hidden.value = ids.value.filter((x) => x !== id);
};
const toggleModes = (id: string) => {
  modes.value = modes.value.includes(id)
    ? modes.value.filter((x) => x !== id)
    : [...modes.value, id];
};

if (import.meta.client) {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (
      e.key !== "/" || t?.closest("input, textarea, select, [contenteditable]")
    ) return;
    e.preventDefault();
    search.value?.focus();
  };
  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
</script>

<template>
  <aside class="sidebar" aria-label="Runtimes">
    <div class="sidebar__head">
      <h2
        class="sidebar__title">Runtimes <span class="sidebar__count">{{ shownCount }}</span></h2>
      <button v-if="hidden.length || modes.length" type="button"
        class="icon-button" title="Show every runtime"
        aria-label="Show every runtime" @click="hidden = []; modes = []">
        <RotateCcw :size="15" aria-hidden="true" />
      </button>
    </div>

    <label class="sidebar__search">
      <span class="visually-hidden">Find runtimes</span>
      <input ref="search" v-model="query" type="search"
        placeholder="Find runtimes" autocomplete="off" />
      <kbd aria-hidden="true">/</kbd>
    </label>

    <ul class="runtime-list">
      <li v-for="id in listed" :key="id">
        <div class="runtime-list__row">
          <button type="button" class="runtime-list__item" :data-runtime="id"
            :data-state="hidden.includes(id) ? 'off' : 'on'"
            :aria-pressed="!hidden.includes(id)"
            :title="`Click to ${hidden.includes(id) ? 'show' : 'hide'}, Alt-click to show only ${nameOf(id)}`"
            @click="$event.altKey ? solo(id) : toggle(id)">
            <span class="runtime-dot" :data-runtime="id" />
            <span class="runtime-list__name">{{ nameOf(id) }}</span>
          </button>
          <button v-if="hasModes(id)" type="button" class="icon-button"
            :aria-pressed="modes.includes(id)"
            :aria-label="`${modes.includes(id) ? 'Hide' : 'Show'} ${nameOf(id)}'s VM modes`"
            :title="`${modes.includes(id) ? 'Hide' : 'Show'} ${nameOf(id)}'s other VM modes on the charts (main line: ${runtimeOf(id)?.variant?.name})`"
            @click="toggleModes(id)">
            <GitBranch :size="16" aria-hidden="true" />
          </button>
        </div>
        <ul v-if="modesOf(id).length && !hidden.includes(id)"
          class="runtime-list__modes">
          <li class="runtime-list__mode" :data-runtime="id">
            {{ runtimeOf(id)?.variant?.name }} <small>main line</small>
          </li>
          <li v-for="m in modesOf(id)" :key="m.id" class="runtime-list__mode"
            :data-runtime="id">
            {{ m.variant?.name }}
          </li>
        </ul>
      </li>
      <li v-if="!listed.length"
        class="runtime-list__empty">No runtime matches.</li>
    </ul>
  </aside>
</template>
