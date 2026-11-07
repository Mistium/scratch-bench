<script setup lang="ts">
import { ArrowLeftRight } from "lucide-vue-next";
import type { CompareMetric } from "~/composables/useCompareMetrics";
const { host, baseline, log, compareX, compareY } = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf, indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();
const shown = useShown();
const metrics = useCompareMetrics();

const byId = (id: string, fallback: string) =>
  metrics.value.find((m) => m.id === id) ??
    metrics.value.find((m) => m.id === fallback)!;
const mx = computed(() => byId(compareX.value, "memory"));
const my = computed(() => byId(compareY.value, "speed"));

const points = computed(() =>
  (latest.value?.runtimes ?? [])
    .filter((r) => shown(r.id))
    .map((r) => ({
      id: r.id,
      x: mx.value.value(r.id),
      y: my.value.value(r.id),
    }))
    .filter((p): p is { id: string; x: number; y: number } =>
      p.x != null && p.y != null
    )
);

const ranking = computed(() =>
  rankFor(
    points.value.map((p) => ({
      id: p.id,
      values: { [mx.value.id]: p.x, [my.value.id]: p.y },
    })),
    [mx.value, my.value],
  )
);
const winner = computed(() => ranking.value[0]?.id);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const goodSide = (m: CompareMetric, values: number[]) =>
  m.better === "higher" ? [median(values), 1e12] : [1e-6, median(values)];

const axisFor = (m: CompareMetric, values: number[]) => ({
  ...chart.axis(),
  ...(m.linear
    ? {
      type: "value",
      min: Math.max(0, Math.floor((Math.min(...values) - 0.02) * 20) / 20),
      max: 1,
    }
    : { type: log.value ? "log" : "value" }),
  name: m.label,
  axisLabel: { ...chart.axis().axisLabel, formatter: m.fmt },
});

const corner = computed(() =>
  `${my.value.better === "higher" ? "Top" : "Bottom"}-${
    mx.value.better === "higher" ? "right" : "left"
  }`
);

type Box = { x: number; y: number; width: number; height: number };
const hits = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

const frame = ref<HTMLElement | null>(null);
const outside = (b: Box) => {
  const w = frame.value?.clientWidth ?? Infinity;
  const h = frame.value?.clientHeight ?? Infinity;
  return b.x < 0 || b.y < 0 || b.x + b.width > w || b.y + b.height > h;
};

const labelPlacer = () => {
  const dots = new Map<number, Box>();
  let placed: Box[] = [];
  return (p: any) => {
    if (p.dataIndex === 0) placed = [];
    const d: Box = p.rect;
    dots.set(p.dataIndex, d);
    const { width: w, height: h } = p.labelRect;
    const cx = d.x + d.width / 2;
    const cy = d.y + d.height / 2;
    const gap = d.width / 2 + 6;
    const step = h * 0.9;
    const options = [
      [cx + gap, cy, "left", "middle"],
      [cx - gap, cy, "right", "middle"],
      [cx, cy - gap, "center", "bottom"],
      [cx, cy + gap, "center", "top"],
      [cx + gap, cy - step, "left", "middle"],
      [cx + gap, cy + step, "left", "middle"],
      [cx - gap, cy - step, "right", "middle"],
      [cx - gap, cy + step, "right", "middle"],
    ] as const;
    const boxOf = (o: typeof options[number]): Box => ({
      x: o[2] === "left" ? o[0] : o[2] === "right" ? o[0] - w : o[0] - w / 2,
      y: o[3] === "middle" ? o[1] - h / 2 : o[3] === "bottom" ? o[1] - h : o[1],
      width: w,
      height: h,
    });
    let best: typeof options[number] = options[0];
    let bestScore = Infinity;
    for (const o of options) {
      const b = boxOf(o);
      let score = placed.filter((q) => hits(b, q)).length * 2 +
        (outside(b) ? 10 : 0);
      for (const [i, q] of dots) if (i !== p.dataIndex && hits(b, q)) score++;
      if (score < bestScore) [best, bestScore] = [o, score];
      if (!score) break;
    }
    placed.push(boxOf(best));
    return { x: best[0], y: best[1], align: best[2], verticalAlign: best[3] };
  };
};

const option = computed(() => {
  const xs = points.value.map((p) => p.x);
  const ys = points.value.map((p) => p.y);
  const [x0, x1] = goodSide(mx.value, xs);
  const [y0, y1] = goodSide(my.value, ys);
  return {
    ...chart.base(),
    grid: { left: 8, right: 32, top: 28, bottom: 36, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) =>
        `<div class="chart-tooltip"><div class="chart-tooltip__title"><span class="runtime-dot" data-runtime="${p.data.id}"></span>${p.name}</div>
          <div class="chart-tooltip__row"><span>${my.value.label}</span><span>${
          my.value.fmt(p.value[1])
        }</span></div>
          <div class="chart-tooltip__row"><span>${mx.value.label}</span><span>${
          mx.value.fmt(p.value[0])
        }</span></div></div>`,
    },
    dataZoom: [0, 1].map((i) => ({
      type: "inside",
      [i ? "yAxisIndex" : "xAxisIndex"]: 0,
      filterMode: "none",
      zoomOnMouseWheel: "ctrl",
      moveOnMouseWheel: false,
      moveOnMouseMove: true,
    })),
    xAxis: { ...axisFor(mx.value, xs), nameLocation: "middle", nameGap: 30 },
    yAxis: {
      ...axisFor(my.value, ys),
      nameTextStyle: { color: chart.muted(), align: "left" },
    },
    series: [{
      type: "scatter",
      clip: true,
      data: points.value.map((p) => {
        const color = chart.runtimeColor(p.id, indexOf(p.id));
        return {
          id: p.id,
          name: nameOf(p.id),
          value: [p.x, p.y],
          symbol: "circle",
          symbolSize: 12 * (p.id === winner.value ? 1.5 : 1),
          itemStyle: {
            color,
            borderColor: chart.css("--color-bg", "#000"),
            borderWidth: 2,
          },
          label: p.id === winner.value
            ? { color, fontWeight: 700, formatter: `★ ${nameOf(p.id)}` }
            : { color },
        };
      }),
      label: {
        show: true,
        position: "right",
        distance: 8,
        formatter: "{b}",
        fontSize: 12,
        fontWeight: 500,
      },
      labelLayout: labelPlacer(),
      emphasis: { scale: 1.4, label: { show: true } },
      markArea: points.value.length > 2
        ? {
          silent: true,
          itemStyle: { color: chart.css("--color-good-soft", "#e2f3e8") },
          data: [[{ xAxis: x0, yAxis: y0 }, { xAxis: x1, yAxis: y1 }]],
        }
        : undefined,
    }],
  };
});

const swap = () => {
  [compareX.value, compareY.value] = [my.value.id, mx.value.id];
};
</script>

<template>
  <section class="panel efficiency" aria-labelledby="compare-title">
    <header class="panel__header">
      <div>
        <h2 id="compare-title"
          class="panel__title">{{ my.label }} vs {{ mx.label.toLowerCase() }}</h2>
        <p
          class="panel__subtitle">{{ corner }} is best · shaded: better than the median on both · one dot per runtime, latest run · hover a dot for its name, pinch to zoom, drag to pan, double-click to reset</p>
      </div>
      <label class="field field--check">
        <input v-model="log" type="checkbox" class="field__checkbox" />
        <span class="field__label">Logarithmic axes</span>
      </label>
    </header>
    <div class="compare-pick">
      <label class="compare-pick__field">
        <span>Up the side</span>
        <select v-model="compareY" class="field__select">
          <option v-for="m in metrics" :key="m.id" :value="m.id"
            :disabled="m.id === mx.id">{{ m.label }}</option>
        </select>
      </label>
      <button type="button" class="icon-button" title="Swap the axes"
        aria-label="Swap the axes"
        @click="swap"><ArrowLeftRight :size="16" aria-hidden="true" /></button>
      <label class="compare-pick__field">
        <span>Along the bottom</span>
        <select v-model="compareX" class="field__select">
          <option v-for="m in metrics" :key="m.id" :value="m.id"
            :disabled="m.id === my.id">{{ m.label }}</option>
        </select>
      </label>
      <p v-if="winner" class="compare-pick__best"
        title="Fit compares each runtime with the best on both measures: 100% is best on both.">
        Best on both:
        <span class="runtime-dot" :data-runtime="winner" />
        <strong>{{ nameOf(winner) }}</strong> <small>{{ Math.round(ranking[0]!.fit * 100) }}% fit</small>
      </p>
    </div>
    <p v-if="!points.length" class="panel__note" data-state="empty">
      No runtime has both a {{ my.label.toLowerCase() }} and a {{ mx.label.toLowerCase() }} reading yet.
    </p>
    <div v-else ref="frame">
      <ChartBase :option="option" :height="520"
        :label="`Scatter plot of each runtime's ${my.label.toLowerCase()} against its ${mx.label.toLowerCase()}`" />
    </div>
  </section>
</template>
