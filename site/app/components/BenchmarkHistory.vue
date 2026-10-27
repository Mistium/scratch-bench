<script setup lang="ts">
import { BENCHMARK_BY_ID } from "#shared/benchmarks";

const props = defineProps<{ id: string }>();

const { host, baseline, mode, log, hidden, range } = useBenchState();
const { data: meta } = await useMetaData();
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const bench = computed(() => BENCHMARK_BY_ID[props.id]);
const fmt = (
  v: number | null | undefined,
) => (mode.value === "relative" ? fmtSpeedup(v) : fmtOps(v));

const from = computed(() => rangeStart(range.value, meta.value?.latest));
const { data: history, pending } = useHistory(() => [props.id], host, from);

const historicalOption = computed(() => {
  const h = history.value;
  if (!h) return {};
  const baseSeries = h.runtimes[baseline.value]?.bench[props.id];
  const visible = Object.keys(h.runtimes).filter((id) =>
    !hidden.value.includes(id)
  );
  const y = (id: string, i: number): number | null => {
    const v = h.runtimes[id]?.bench[props.id]?.[i];
    if (v == null) return null;
    return mode.value === "absolute"
      ? v
      : baseSeries?.[i]
      ? v / baseSeries[i]!
      : null;
  };
  const revisions: string[] = [];
  let prevHash: string | null = null;
  h.suiteHashes.forEach((hash, i) => {
    const at = h.timestamps[i];
    if (hash && prevHash && hash !== prevHash && at) revisions.push(at);
    if (hash) prevHash = hash;
  });
  const series = visible.map((id, n) => {
    const color = chart.runtimeColor(id, indexOf(id));
    const versionChanges: any[] = [];
    let prev: string | null = null;
    (h.runtimes[id]?.versions ?? []).forEach((v, i) => {
      if (v && prev && v !== prev && y(id, i) != null) {
        versionChanges.push({ coord: [h.timestamps[i], y(id, i)], value: v });
      }
      if (v) prev = v;
    });
    return {
      name: nameOf(id),
      type: "line",
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2, color, type: chart.lineType(id) },
      itemStyle: { color },
      data: h.timestamps.map((t, i) => [t, y(id, i)]),
      markPoint: {
        symbol: "circle",
        symbolSize: 7,
        label: { show: false },
        itemStyle: { color, borderColor: chart.text(), borderWidth: 1 },
        data: versionChanges,
      },
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
    };
  });
  return chart.narrow({
    ...chart.base(),
    grid: {
      left: 8,
      right: 16,
      top: 16,
      bottom: 64 + chart.legendExtra(series.length),
      containLabel: true,
    },
    legend: { ...chart.base().legend, bottom: 30 },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "axis",
      formatter: (params: any[]) => {
        if (!params.length) return "";
        const i = h.timestamps.indexOf(
          new Date(params[0].value[0]).toISOString(),
        );
        const rowsHtml = params
          .filter((p) => p.value[1] != null)
          .sort((a, b) => b.value[1] - a.value[1])
          .map((p) => {
            const id = visible.find((x) => nameOf(x) === p.seriesName)!;
            return `<div class="chart-tooltip__row"><span><span class="runtime-dot" data-runtime="${id}"></span> ${p.seriesName} <small>${
              h.runtimes[id]?.versions[i] ?? ""
            }</small></span><span>${fmt(p.value[1])}</span></div>`;
          })
          .join("");
        return `<div class="chart-tooltip"><div class="chart-tooltip__title">${
          fmtDateTime(h.timestamps[i])
        }</div>${rowsHtml}</div>`;
      },
    },
    xAxis: { type: "time", ...chart.axis() },
    yAxis: {
      type: log.value ? "log" : "value",
      ...chart.axis(),
      axisLabel: {
        ...chart.axis().axisLabel,
        formatter: (v: number) => fmt(v),
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

const revisionCount = computed(() =>
  new Set((history.value?.suiteHashes ?? []).filter(Boolean)).size - 1
);
</script>

<template>
  <div class="bench-history">
    <div class="bench-panel__toolbar">
      <RangePicker />
      <label class="field field--check">
        <input v-model="log" type="checkbox" class="field__checkbox" />
        <span class="field__label">Logarithmic axis</span>
      </label>
    </div>
    <ClientOnly>
      <p v-if="pending || !history" class="panel__note"
        data-state="loading">Loading history…</p>
      <template v-else-if="history.timestamps.length > 1">
        <ChartBase :option="historicalOption"
          :label="`${bench?.label}: result of each runtime over time`" />
        <p v-if="revisionCount > 0" class="panel__note">
          The benchmarks were revised {{ revisionCount }} time{{ revisionCount > 1 ? "s" : "" }} in this range (dashed lines); results
          on either side of a revision are not directly comparable. Dots mark a runtime's version changing.
        </p>
        <p v-else
          class="panel__note">Dots mark a runtime's version changing.</p>
      </template>
      <p v-else class="panel__note"
        data-state="empty">There is not enough history for this range yet.</p>
      <template #fallback>
        <p class="panel__note" data-state="loading">Loading history…</p>
      </template>
    </ClientOnly>
  </div>
</template>
