<script setup lang="ts">
import { CATEGORIES, CATEGORY_IDS } from "#shared/benchmarks";

const { host, baseline, weights } = useBenchState();
const { data: meta } = await useMetaData();
const { data: scores } = await useScoreData(host, weights);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const rows = computed(() => {
  const s = scores.value;
  if (!s) return [];
  return Object.entries(s.runtimes)
    .map(([id, series]) => ({
      id,
      name: nameOf(id),
      total: lastValue(series.total),
      categories: Object.fromEntries(
        CATEGORY_IDS.map((c) => [c, lastValue(series.categories[c])]),
      ) as Record<string, number | null>,
    }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
});

const best = computed(() =>
  Object.fromEntries(
    CATEGORY_IDS.map((c) => [
      c,
      Math.max(0, ...rows.value.map((r) => r.categories[c] ?? 0)),
    ]),
  ) as Record<string, number>
);

const tier = (c: string, x: number | null | undefined) => {
  const top = best.value[c];
  if (x == null || !top) return "none";
  const gap = Math.log10(top / x);
  return gap <= 0.15 ? "3" : gap <= 0.5 ? "2" : gap <= 1.2 ? "1" : "0";
};

const position = (c: string, x: number | null | undefined) => {
  const top = best.value[c];
  if (x == null || !top) return 0;
  return Math.max(0, 1 + Math.log10(x / top) / 3);
};

const option = computed(() => {
  const plotted = rows.value.filter((r) => r.total != null);
  const base = {
    ...chart.base(),
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) => {
        const row = rows.value.find((r) => r.name === p.name);
        return `<div class="chart-tooltip"><div class="chart-tooltip__title">${p.name}</div>${
          CATEGORY_IDS.map(
            (c) =>
              `<div class="chart-tooltip__row"><span>${
                CATEGORIES[c].label
              }</span><span>${fmtOps(row?.categories[c])}</span></div>`,
          ).join("")
        }</div>`;
      },
    },
    legend: {
      ...chart.base().legend,
      bottom: 0,
      data: plotted.map((r) => r.name),
    },
    radar: {
      radius: "52%",
      center: ["50%", "46%"],
      indicator: CATEGORY_IDS.map((c) => ({
        name: CATEGORIES[c].label,
        max: 1,
      })),
      axisName: {
        color: chart.muted(),
        formatter: (name: string) =>
          name.replace(" & ", " &\n").replace(" ", "\n"),
      },
      splitLine: { lineStyle: { color: chart.grid() } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: chart.grid() } },
    },
    series: [
      {
        type: "radar",
        symbol: "none",
        data: plotted.map((r) => ({
          name: r.name,
          value: CATEGORY_IDS.map((c) => position(c, r.categories[c])),
          lineStyle: {
            color: chart.runtimeColor(r.id, indexOf(r.id)),
            width: 2,
          },
          itemStyle: { color: chart.runtimeColor(r.id, indexOf(r.id)) },
          areaStyle: {
            opacity: 0.08,
            color: chart.runtimeColor(r.id, indexOf(r.id)),
          },
        })),
      },
    ],
  };
  return {
    baseOption: base,
    media: [{ query: { maxWidth: 560 }, option: { radar: { radius: "38%" } } }],
  };
});
</script>

<template>
  <section class="panel category-scores" aria-labelledby="category-title">
    <header class="panel__header">
      <h2 id="category-title" class="panel__title">Performance by category</h2>
      <p class="panel__subtitle">
        The radar shows each runtime against the best one in every category, on a logarithmic scale. The table has the scores,
        with each category's weight.
      </p>
    </header>

    <div class="category-scores__body">
      <ChartBase :option="option"
        label="Radar chart of each runtime's performance in every category, relative to the best, logarithmic scale" />

      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              <th v-for="c in CATEGORY_IDS" :key="c" scope="col"
                class="table__number" :title="CATEGORIES[c].description">
                {{ CATEGORIES[c].label }}
                <span class="table__sub">×{{ weights === "default" ? CATEGORIES[c].weight : 1 }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="table__row"
              :data-runtime="r.id">
              <th scope="row"
                class="table__name"><span class="runtime-dot" :data-runtime="r.id" /> {{ r.name }}</th>
              <td v-for="c in CATEGORY_IDS" :key="c" class="table__number heat"
                :data-tier="tier(c, r.categories[c])">
                {{ fmtOps(r.categories[c]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
