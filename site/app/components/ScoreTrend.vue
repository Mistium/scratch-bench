<script setup lang="ts">
const { host, baseline, weights, trendRange: range } = useBenchState();
const { data: meta } = await useMetaData();
const { data: scores } = await useScoreData(host, weights);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const option = computed(() => {
  const s = scores.value;
  const from = rangeStart(range.value, s?.timestamps.at(-1));
  const start = from ? s!.timestamps.findIndex((t) => t >= from) : 0;
  const first = Math.max(0, start);
  const revisions: string[] = [];
  let prevHash: string | null = null;
  (s?.suiteHashes ?? []).forEach((hash, i) => {
    const at = s!.timestamps[i];
    if (hash && prevHash && hash !== prevHash && at && (!from || at >= from)) {
      revisions.push(at);
    }
    if (hash) prevHash = hash;
  });
  const series = Object.entries(s?.runtimes ?? {}).map(([id, v], n) => ({
    name: nameOf(id),
    type: "line",
    showSymbol: false,
    connectNulls: false,
    lineStyle: {
      width: 2,
      color: chart.runtimeColor(id, indexOf(id)),
      type: chart.lineType(id),
    },
    itemStyle: { color: chart.runtimeColor(id, indexOf(id)) },
    data: s!.timestamps.slice(first).map((t, i) => [t, v.total[first + i]]),
    markLine: n === 0 && revisions.length
      ? {
        silent: true,
        symbol: "none",
        lineStyle: { color: chart.muted(), type: "dashed" },
        label: {
          formatter: "benchmarks revised",
          color: chart.muted(),
          position: "insideEndTop",
        },
        data: revisions.map((t) => ({ xAxis: t })),
      }
      : undefined,
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
      type: "log",
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => fmtOps(v),
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
});
</script>

<template>
  <section class="panel score-trend" aria-labelledby="trend-title">
    <header class="panel__header">
      <h2 id="trend-title" class="panel__title">Performance over time</h2>
      <RangePicker scope="trend" />
    </header>
    <p v-if="scores && scores.timestamps.length < 2"
      class="panel__note">History appears here once there is more than one run.</p>
    <ChartBase :option="option"
      label="Overall performance of each runtime over time" />
  </section>
</template>
