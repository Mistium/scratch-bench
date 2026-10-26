<script setup lang="ts">
const { host, baseline } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const rows = computed(() =>
  (latest.value?.runtimes ?? [])
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
  return {
    ...chart.base(),
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) => `${p.name}: ${unit(p.value)}`,
    },
    xAxis: { type: "log", ...chart.axis() },
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
        barMaxWidth: 20,
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

    <div class="resource-use__charts">
      <div class="resource-use__chart">
        <h3 class="resource-use__title">Startup time</h3>
        <ChartBase :option="startupOption" small
          label="Startup time of each runtime, logarithmic scale" />
      </div>
      <div class="resource-use__chart">
        <h3 class="resource-use__title">Peak memory</h3>
        <ChartBase :option="memoryOption" small
          label="Peak memory of each runtime, logarithmic scale" />
      </div>
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
