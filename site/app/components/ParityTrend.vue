<script setup lang="ts">
const { host, baseline, parityRange: range } = useBenchState();
const { data: meta } = await useMetaData();
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const from = ref<string | undefined>(undefined);
const { data: history } = useHistory([], host, from);

const hasData = computed(() =>
  Object.values(history.value?.runtimes ?? {}).some((r) =>
    r.parity_total.some((t) => t != null)
  )
);

const option = computed(() => {
  const h = history.value;
  const cut = rangeStart(range.value, h?.timestamps.at(-1));
  const first = Math.max(0, cut ? h!.timestamps.findIndex((t) => t >= cut) : 0);
  const stamps = h?.timestamps.slice(first) ?? [];
  const series = Object.entries(h?.runtimes ?? {})
    .filter(([, r]) => r.parity_total.some((t) => t != null))
    .map(([id, r]) => {
      const color = chart.runtimeColor(id, indexOf(id));
      const point = (i: number) => {
        const total = r.parity_total[first + i];
        const passed = r.parity_passed[first + i];
        return {
          value: [
            stamps[i],
            total ? (passed ?? 0) / total : null,
          ],
          passed,
          total,
          version: r.versions[first + i],
          backfilled: r.backfilled[first + i],
          itemStyle: r.backfilled[first + i]
            ? { color: "transparent", borderColor: color, borderWidth: 2 }
            : { color },
        };
      };
      return {
        name: nameOf(id),
        type: "line",
        symbolSize: 6,
        connectNulls: false,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        data: stamps.map((_, i) => point(i)),
      };
    });
  return chart.narrow({
    ...chart.base(),
    grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "axis",
      formatter: (params: any[]) => {
        const rows = params
          .filter((p) => p.data?.total)
          .map((p) =>
            `${p.marker} ${p.seriesName}: ${p.data.passed} / ${p.data.total} (${
              fmtPercent(p.data.value[1])
            })` +
            (p.data.version ? ` · ${p.data.version}` : "") +
            (p.data.backfilled ? " · measured later" : "")
          );
        return `${fmtDate(params[0]?.value?.[0])}<br>${rows.join("<br>")}`;
      },
    },
    legend: { ...chart.base().legend, bottom: 28 },
    xAxis: { type: "time", ...chart.axis() },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => fmtPercent(v),
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
  <section class="panel parity-trend" aria-labelledby="parity-trend-title">
    <header class="panel__header">
      <h2 id="parity-trend-title" class="panel__title">Parity over time</h2>
      <RangePicker scope="parity" />
    </header>
    <p class="panel__subtitle">
      The share of scratch-parity checks each runtime passes. Hollow points were measured later, by running today's checks
      against the version of the runtime that was current on that day.
    </p>
    <p v-if="history && !hasData"
      class="panel__note">Parity history appears here once there is parity data.</p>
    <ChartBase v-else :option="option"
      label="Parity pass rate of each runtime over time" />
  </section>
</template>
