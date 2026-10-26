<script setup lang="ts">
import { BENCHMARK_BY_ID } from "#shared/benchmarks";

const props = defineProps<
  { id: string; initialTab?: "current" | "historical" }
>();

const { host, baseline, mode, log, hidden, range } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const bench = computed(() => BENCHMARK_BY_ID[props.id]);
const tab = ref<"current" | "historical">(props.initialTab ?? "current");
const tabId = `tabs-${props.id}`;

const runtimes = computed(() =>
  (latest.value?.runtimes ?? []).filter((r) => !hidden.value.includes(r.id))
);
const baseMedian = computed(() =>
  latest.value?.runtimes.find((r) => r.id === baseline.value)
    ?.benchmarks[props.id]?.median ?? null
);

const scale = (
  v: number | null | undefined,
  base: number | null | undefined = baseMedian.value,
) => {
  if (v == null) return null;
  if (mode.value === "absolute") return v;
  return base ? v / base : null;
};
const fmt = (
  v: number | null | undefined,
) => (mode.value === "relative" ? fmtSpeedup(v) : fmtOps(v));

const rows = computed(() =>
  runtimes.value
    .map((r) => {
      const s = r.benchmarks[props.id];
      return {
        id: r.id,
        name: r.name,
        version: r.version,
        s,
        shown: scale(s?.median),
        rsd: s && s.mean > 0 ? s.stddev / s.mean : null,
      };
    })
    .sort((a, b) => (b.shown ?? -1) - (a.shown ?? -1))
);

const currentOption = computed(() => {
  const withData = rows.value.filter((r) => r.s);
  const names = withData.map((r) => r.name);
  const spread = (key: "min" | "max") =>
    withData.map((r) => [r.name, scale(r.s![key])]);
  return {
    ...chart.base(),
    grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any[]) => {
        const r = rows.value.find((x) => x.name === params[0]?.name);
        if (!r?.s) return "";
        return `<div class="chart-tooltip"><div class="chart-tooltip__title">${r.name}</div>
          <div class="chart-tooltip__row"><span>median</span><span>${
          fmt(r.shown)
        }</span></div>
          <div class="chart-tooltip__row"><span>range</span><span>${
          fmt(scale(r.s.min))
        } – ${fmt(scale(r.s.max))}</span></div>
          <div class="chart-tooltip__row"><span>spread</span><span>${
          fmtPercent(r.rsd)
        }</span></div></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: names,
      ...chart.axis(),
      splitLine: { show: false },
    },
    yAxis: {
      type: log.value ? "log" : "value",
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => fmt(v),
      },
    },
    series: [
      {
        name: "median",
        type: "bar",
        barMaxWidth: 56,
        data: withData.map((r) => ({
          value: r.shown,
          itemStyle: { color: chart.runtimeColor(r.id, indexOf(r.id)) },
        })),
        label: {
          show: true,
          position: "top",
          color: chart.text(),
          formatter: (p: any) => fmt(p.value),
        },
      },
      {
        name: "min",
        type: "scatter",
        symbol: "rect",
        symbolSize: [18, 2],
        itemStyle: { color: chart.text() },
        data: spread("min"),
        z: 5,
      },
      {
        name: "max",
        type: "scatter",
        symbol: "rect",
        symbolSize: [18, 2],
        itemStyle: { color: chart.text() },
        data: spread("max"),
        z: 5,
      },
    ],
  };
});
</script>

<template>
  <div v-if="bench" class="bench-panel" :data-tab="tab">
    <div class="tabs" role="tablist" :aria-label="`${bench.label} results`">
      <button :id="`${tabId}-current`" type="button" role="tab"
        class="tabs__tab" :data-state="tab === 'current' ? 'active' : 'idle'"
        :aria-selected="tab === 'current'"
        :aria-controls="`${tabId}-current-panel`" @click="tab = 'current'">
        Current
      </button>
      <button :id="`${tabId}-historical`" type="button" role="tab"
        class="tabs__tab" :data-state="tab === 'historical' ? 'active' : 'idle'"
        :aria-selected="tab === 'historical'"
        :aria-controls="`${tabId}-historical-panel`"
        @click="tab = 'historical'">
        Historical
      </button>
    </div>

    <div v-if="tab === 'current'" :id="`${tabId}-current-panel`" role="tabpanel"
      :aria-labelledby="`${tabId}-current`" class="bench-panel__body">
      <ChartBase :option="currentOption" small
        :label="`${bench.label}: result of each runtime`" />
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              <th scope="col">Version</th>
              <th scope="col" class="table__number">Speedup</th>
              <th scope="col"
                class="table__number">Median ({{ bench.unit }}/ms)</th>
              <th scope="col" class="table__number">Mean</th>
              <th scope="col" class="table__number">Std. dev.</th>
              <th scope="col" class="table__number">Spread</th>
              <th scope="col" class="table__number">Min</th>
              <th scope="col" class="table__number">Max</th>
              <th scope="col" class="table__number">Runs</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="table__row"
              :data-runtime="r.id">
              <th scope="row"
                class="table__name"><span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}</th>
              <td class="table__mono">{{ r.version }}</td>
              <td
                class="table__number">{{ fmtSpeedup(r.s && baseMedian ? r.s.median / baseMedian : null) }}</td>
              <td class="table__number">{{ fmtOps(r.s?.median) }}</td>
              <td class="table__number">{{ fmtOps(r.s?.mean) }}</td>
              <td class="table__number">{{ fmtOps(r.s?.stddev) }}</td>
              <td class="table__number">{{ fmtPercent(r.rsd) }}</td>
              <td class="table__number">{{ fmtOps(r.s?.min) }}</td>
              <td class="table__number">{{ fmtOps(r.s?.max) }}</td>
              <td class="table__number">{{ r.s?.n ?? "–" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else :id="`${tabId}-historical-panel`" role="tabpanel"
      :aria-labelledby="`${tabId}-historical`" class="bench-panel__body">
      <BenchmarkHistory :id="id" />
    </div>
  </div>
</template>
