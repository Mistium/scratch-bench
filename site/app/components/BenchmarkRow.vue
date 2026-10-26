<script setup lang="ts">
import { type Benchmark, CATEGORIES } from "#shared/benchmarks";

defineProps<{
  bench: Benchmark;
  runtimeIds: string[];
  expanded: boolean;
  text: (runtime: string, bench: string) => string;
  best: string | null;
}>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <tbody class="bench-row" :data-state="expanded ? 'open' : 'closed'"
    :data-category="bench.category">
    <tr class="table__row">
      <th scope="row" class="table__name bench-row__name">
        <button type="button" class="bench-row__toggle"
          :aria-expanded="expanded" :aria-controls="`row-${bench.id}`"
          @click="$emit('toggle')">
          <span class="bench-row__chevron" aria-hidden="true" />
          <span class="bench-row__label">{{ bench.label }}</span>
        </button>
        <span class="bench-row__meta">
          <span class="badge"
            :data-category="bench.category">{{ CATEGORIES[bench.category].label }}</span>
          <code class="bench-row__id">{{ bench.id }}</code>
          <NuxtLink class="bench-row__link" :to="`/benchmark/${bench.id}`"
            :aria-label="`Open ${bench.label} on its own page`">open</NuxtLink>
        </span>
      </th>
      <td v-for="id in runtimeIds" :key="id" class="table__number"
        :data-runtime="id" :data-best="best === id">
        {{ text(id, bench.id) }}
      </td>
    </tr>
    <tr v-if="expanded" :id="`row-${bench.id}`" class="bench-row__details">
      <td :colspan="runtimeIds.length + 1">
        <p
          class="bench-row__description">{{ bench.description }} One operation is one {{ bench.unit.replace(/s$/, "") }}.</p>
        <BenchmarkPanel :id="bench.id" />
      </td>
    </tr>
  </tbody>
</template>
