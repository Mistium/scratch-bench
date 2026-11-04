<script setup lang="ts">
import { BENCHMARK_BY_ID } from "#shared/benchmarks";

const props = defineProps<{ id: string }>();

const { host, baseline, mode, log } = useBenchState();
const shown = useShown();
const { data: meta } = useMetaData();
const { nameOf } = useRuntimes(meta, baseline);
const bench = computed(() => BENCHMARK_BY_ID[props.id]);

const { data: history, pending } = useHistory(
  () => [props.id],
  host,
  () => undefined,
);

const series = computed(() => {
  const h = history.value;
  if (!h) return [];
  const base = h.runtimes[baseline.value]?.bench[props.id];
  return Object.keys(h.runtimes)
    .filter((id) => shown(id))
    .map((id) => ({
      id,
      name: nameOf(id),
      values: (h.runtimes[id]?.bench[props.id] ?? []).map((v, i) =>
        v == null
          ? null
          : mode.value === "absolute"
          ? v
          : base?.[i]
          ? v / base[i]!
          : null
      ),
    }));
});

const format = (
  v: number | null | undefined,
) => (mode.value === "relative" ? fmtSpeedup(v) : fmtOps(v));
</script>

<template>
  <BarReplay v-if="history && history.timestamps.length > 1"
    :timestamps="history.timestamps"
    :series="series" :format="format" :log="log" vertical
    :label="`${bench?.label ?? id}: result of each runtime`" />
  <p v-else class="panel__note" :data-state="pending ? 'loading' : 'empty'">
    {{ pending ? "Loading history…" : "There is not enough history yet." }}
  </p>
</template>
