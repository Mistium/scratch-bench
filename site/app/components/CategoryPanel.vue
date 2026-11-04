<script setup lang="ts">
import { CATEGORIES, type CategoryId } from "#shared/benchmarks";

const props = defineProps<{ id: CategoryId }>();

const { host, baseline, weights, log, trendRange: range } = useBenchState();
const shown = useShown();
const { data: meta } = await useMetaData();
const { data: scores } = await useScoreData(host, weights);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const category = computed(() => CATEGORIES[props.id]);
const tab = ref<"current" | "historical">("current");
const replaying = ref(false);
const replaySeries = computed(() =>
  Object.entries(scores.value?.runtimes ?? {})
    .filter(([id]) => shown(id))
    .map(([id, s]) => ({ id, name: nameOf(id), values: s.categories[props.id] ?? [] }))
);

const rows = computed(() =>
  Object.entries(scores.value?.runtimes ?? {})
    .filter(([id]) => shown(id))
    .map(([id, series]) => ({
      id,
      name: nameOf(id),
      value: lastValue(series.categories[props.id]),
    }))
    .filter((r) => r.value != null)
    .sort((a, b) => b.value! - a.value!)
);

const best = computed(() => rows.value[0]?.value ?? null);
const chartHeight = computed(() => Math.max(224, rows.value.length * 26 + 40));

const barOption = computed(() => {
  const min = rows.value.length ? Math.min(...rows.value.map((r) => r.value!)) : 1;
  return {
    ...chart.base(),
    grid: { left: 8, right: 64, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) => `${p.name}: ${fmtOps(p.value)}`,
    },
    xAxis: {
      type: log.value ? "log" : "value",
      min: log.value ? 10 ** (Math.floor(Math.log10(min)) - 1) : 0,
      ...chart.axis(),
      axisLabel: { ...chart.axis().axisLabel, formatter: (v: number) => fmtOps(v) },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.value.map((r) => r.name),
      ...chart.axis(),
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      barMaxWidth: 18,
      barCategoryGap: "30%",
      data: rows.value.map((r) => ({
        value: r.value,
        itemStyle: { color: chart.runtimeColor(r.id, indexOf(r.id)) },
      })),
      label: {
        show: true,
        position: "right",
        color: chart.text(),
        formatter: (p: any) => fmtOps(p.value),
      },
    }],
  };
});

const historicalOption = computed(() => {
  const s = scores.value;
  const from = rangeStart(range.value, s?.timestamps.at(-1));
  const first = Math.max(0, from ? s!.timestamps.findIndex((t) => t >= from) : 0);
  const series = Object.entries(s?.runtimes ?? {})
    .filter(([id]) => shown(id))
    .map(([id, v]) => ({
      name: nameOf(id),
      type: "line",
      showSymbol: false,
      lineStyle: {
        width: 2,
        color: chart.runtimeColor(id, indexOf(id)),
        type: chart.lineType(id),
      },
      itemStyle: { color: chart.runtimeColor(id, indexOf(id)) },
      data: s!.timestamps.slice(first)
        .map((t, i) => [t, v.categories[props.id]?.[first + i] ?? null])
        .filter(([, x]) => x != null),
    }));
  return chart.narrow({
    ...chart.base(),
    grid: {
      left: 8,
      right: 16,
      top: 16,
      bottom: 56 + chart.legendExtra(series.length),
      containLabel: true,
    },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "axis",
      valueFormatter: (v: number | null) => fmtOps(v),
    },
    legend: { ...chart.base().legend, bottom: 28 },
    xAxis: { type: "time", ...chart.axis() },
    yAxis: {
      type: log.value ? "log" : "value",
      ...chart.axis(),
      axisLabel: { ...chart.axis().axisLabel, formatter: (v: number) => fmtOps(v) },
    },
    dataZoom: [{
      type: "slider",
      height: 16,
      bottom: 4,
      textStyle: { color: chart.muted() },
    }, { type: "inside" }],
    series,
  });
});
</script>

<template>
  <div class="bench-panel" :data-tab="tab">
    <div class="tabs" role="tablist" :aria-label="`${category.label} results`">
      <button type="button" role="tab" class="tabs__tab"
        :data-state="tab === 'current' ? 'active' : 'idle'"
        :aria-selected="tab === 'current'" @click="tab = 'current'">Current</button>
      <button type="button" role="tab" class="tabs__tab"
        :data-state="tab === 'historical' ? 'active' : 'idle'"
        :aria-selected="tab === 'historical'" @click="tab = 'historical'">Historical</button>
    </div>

    <div class="bench-panel__toolbar">
      <RangePicker v-if="tab === 'historical'" scope="trend" />
      <ReplayToggle v-else v-model="replaying" />
      <label class="field field--check">
        <input v-model="log" type="checkbox" class="field__checkbox" />
        <span class="field__label">Logarithmic axis</span>
      </label>
    </div>

    <div v-if="tab === 'current'" class="bench-panel__body">
      <BarReplay v-if="replaying && (scores?.timestamps.length ?? 0) > 1" :timestamps="scores!.timestamps"
        :series="replaySeries" :format="fmtOps" :log="log" :label="`${category.label} score of each runtime`" />
      <ChartBase v-else :option="barOption" small :height="chartHeight"
        :label="`${category.label} score of each runtime, ${log ? 'logarithmic' : 'linear'} scale`" />
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col" class="table__rank">#</th>
              <th scope="col">Runtime</th>
              <th scope="col" class="table__number">Score</th>
              <th scope="col" class="table__number">vs best</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id" class="table__row"
              :data-runtime="r.id">
              <td class="table__rank">{{ i + 1 }}</td>
              <th scope="row" class="table__name"><span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}</th>
              <td class="table__number table__strong">{{ fmtOps(r.value) }}</td>
              <td class="table__number">{{ best ? fmtPercent(r.value! / best) : "–" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else class="bench-panel__body">
      <ChartBase v-if="(scores?.timestamps.length ?? 0) > 1" :option="historicalOption"
        :label="`${category.label} score of each runtime over time`" />
      <p v-else class="panel__note" data-state="empty">There is not enough history yet.</p>
    </div>
  </div>
</template>
