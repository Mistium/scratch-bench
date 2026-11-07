<script setup lang="ts">
const { host, baseline, log, range } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();
const shown = useShown();

const tab = ref<"current" | "historical">("current");
const replayStartup = ref(false);
const replayMemory = ref(false);

const from = computed(() =>
  tab.value === "historical"
    ? rangeStart(range.value, meta.value?.latest)
    : undefined
);
const { data: history, pending } = useHistory([], host, from);

const replaySeries = (pick: "startup_ms" | "peak_rss_mb") =>
  Object.entries(history.value?.runtimes ?? {})
    .filter(([id]) => shown(id))
    .map(([id, r]) => ({ id, name: nameOf(id), values: r[pick] }));

const canReplay = computed(() => (history.value?.timestamps.length ?? 0) > 1);

const rows = computed(() =>
  (latest.value?.runtimes ?? [])
    .filter((r) => shown(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      launcher: r.launcher,
      startup: r.startup_ms,
      memory: r.peak_rss_mb,
    }))
    .sort((a, b) =>
      (a.startup?.median ?? Infinity) - (b.startup?.median ?? Infinity)
    )
);

const barOption = (pick: "startup" | "memory", unit: (x: number) => string) => {
  const sorted = [...rows.value].filter((r) => r[pick]).sort((a, b) =>
    a[pick]!.median - b[pick]!.median
  );
  const min = sorted.length
    ? Math.min(...sorted.map((r) => r[pick]!.median))
    : 1;
  return {
    ...chart.base(),
    grid: { left: 8, right: 64, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) => `${p.name}: ${unit(p.value)}`,
    },
    xAxis: {
      type: log.value ? "log" : "value",
      min: log.value ? 10 ** (Math.floor(Math.log10(min)) - 1) : 0,
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => unit(v),
      },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: sorted.map((r) => r.name),
      ...chart.axis(),
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 18,
        barCategoryGap: "30%",
        data: sorted.map((r) => ({
          value: r[pick]!.median,
          itemStyle: { color: chart.runtimeColor(r.id, indexOf(r.id)) },
        })),
        label: {
          show: true,
          position: "right",
          color: chart.text(),
          formatter: (p: any) => unit(p.value),
        },
      },
    ],
  };
};

const lineOption = (
  pick: "startup_ms" | "peak_rss_mb",
  unit: (x: number | null | undefined) => string,
) => {
  const h = history.value;
  if (!h) return {};
  const series = Object.entries(h.runtimes)
    .filter(([id, r]) => shown(id) && r[pick].some((v) => v != null))
    .map(([id, r]) => {
      const color = chart.runtimeColor(id, indexOf(id));
      return {
        name: nameOf(id),
        type: "line",
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color, type: chart.lineType(id) },
        itemStyle: { color },
        data: h.timestamps.map((t, i) => [t, r[pick][i]])
          .filter(([, v]) => v != null),
      };
    });
  return chart.narrow({
    ...chart.base(),
    grid: {
      left: 8,
      right: 16,
      top: 16,
      bottom: 56 + chart.legendExtra(series.length),
      containLabel: true,
    },
    legend: { ...chart.base().legend, bottom: 28 },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "axis",
      valueFormatter: (v: number | null) => unit(v),
    },
    xAxis: { type: "time", ...chart.axis() },
    yAxis: {
      type: log.value ? "log" : "value",
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => unit(v),
      },
    },
    dataZoom: [{
      type: "slider",
      height: 16,
      bottom: 4,
      textStyle: { color: chart.muted() },
    }, { type: "inside" }],
    series,
  });
};

const chartHeight = computed(() => Math.max(224, rows.value.length * 26 + 40));

const startupHistory = computed(() => lineOption("startup_ms", fmtMs));
const memoryHistory = computed(() => lineOption("peak_rss_mb", fmtMb));

const startupOption = computed(() => barOption("startup", fmtMs));
const memoryOption = computed(() => barOption("memory", fmtMb));
</script>

<template>
  <section class="panel resource-use" aria-labelledby="resource-title">
    <header class="panel__header">
      <h2 id="resource-title" class="panel__title">Startup and memory</h2>
      <p class="panel__subtitle">
        Startup is the time from launching the runtime until the project prints its first line. Memory is the peak size of the
        process that was launched, so Node-hosted runtimes include Node itself. Lower is better.
      </p>
    </header>

    <div class="tabs" role="tablist" aria-label="Startup and memory results">
      <button type="button" role="tab" class="tabs__tab"
        :data-state="tab === 'current' ? 'active' : 'idle'"
        :aria-selected="tab === 'current'"
        @click="tab = 'current'">Current</button>
      <button type="button" role="tab" class="tabs__tab"
        :data-state="tab === 'historical' ? 'active' : 'idle'"
        :aria-selected="tab === 'historical'"
        @click="tab = 'historical'">Historical</button>
    </div>

    <div class="bench-panel__toolbar">
      <RangePicker v-if="tab === 'historical'" />
      <label class="field field--check">
        <input v-model="log" type="checkbox" class="field__checkbox" />
        <span class="field__label">Logarithmic axis</span>
      </label>
    </div>

    <div v-if="tab === 'current'" class="resource-use__charts">
      <div class="resource-use__chart">
        <div class="resource-use__head">
          <h3 class="resource-use__title">Startup time</h3>
          <ReplayToggle v-model="replayStartup" />
        </div>
        <BarReplay v-if="replayStartup && canReplay"
          :timestamps="history!.timestamps"
          :series="replaySeries('startup_ms')" :format="fmtMs" :log="log"
          label="Startup time of each runtime" />
        <ChartBase v-else :option="startupOption" small :height="chartHeight"
          :label="`Startup time of each runtime, ${log ? 'logarithmic' : 'linear'} scale`" />
      </div>
      <div class="resource-use__chart">
        <div class="resource-use__head">
          <h3 class="resource-use__title">Peak memory</h3>
          <ReplayToggle v-model="replayMemory" />
        </div>
        <BarReplay v-if="replayMemory && canReplay"
          :timestamps="history!.timestamps"
          :series="replaySeries('peak_rss_mb')" :format="fmtMb" :log="log"
          label="Peak memory of each runtime" />
        <ChartBase v-else :option="memoryOption" small :height="chartHeight"
          :label="`Peak memory of each runtime, ${log ? 'logarithmic' : 'linear'} scale`" />
      </div>
    </div>

    <div v-else class="resource-use__charts">
      <p v-if="pending || !history" class="panel__note"
        data-state="loading">Loading history…</p>
      <p v-else-if="history.timestamps.length < 2" class="panel__note"
        data-state="empty">There is not enough history for this range yet.</p>
      <template v-else>
        <div class="resource-use__chart">
          <h3 class="resource-use__title">Startup time</h3>
          <ChartBase :option="startupHistory"
            label="Startup time of each runtime over time" />
        </div>
        <div class="resource-use__chart">
          <h3 class="resource-use__title">Peak memory</h3>
          <ChartBase :option="memoryHistory"
            label="Peak memory of each runtime over time" />
        </div>
      </template>
    </div>

    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">Runtime</th>
            <th scope="col">Launcher</th>
            <th scope="col" class="table__number">Startup (median, range)</th>
            <th scope="col"
              class="table__number">Peak memory (median, range)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="table__row"
            :data-runtime="r.id">
            <th scope="row"
              class="table__name"><span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}</th>
            <td>{{ r.launcher ?? "–" }}</td>
            <td class="table__number">
              {{ fmtMs(r.startup?.median) }}
              <span class="table__sub">{{ fmtMs(r.startup?.min) }}–{{ fmtMs(r.startup?.max) }}</span>
            </td>
            <td class="table__number">
              {{ fmtMb(r.memory?.median) }}
              <span class="table__sub">{{ fmtMb(r.memory?.min) }}–{{ fmtMb(r.memory?.max) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
