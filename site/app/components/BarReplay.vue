<script setup lang="ts">
import { Pause, Play, RotateCcw } from "lucide-vue-next";

export interface ReplaySeries {
  id: string;
  name: string;
  values: (number | null)[];
}

const props = defineProps<{
  timestamps: string[];
  series: ReplaySeries[];
  format: (v: number | null | undefined) => string;
  label: string;
  log?: boolean;
  vertical?: boolean;
}>();

const { baseline } = useBenchState();
const { data: meta } = useMetaData();
const { indexOf } = useRuntimes(meta, baseline);
const chart = useChartTheme();

const times = computed(() => props.timestamps.map((t) => new Date(t).getTime()));
const startTime = computed(() => times.value[0] ?? 0);
const endTime = computed(() => times.value[times.value.length - 1] ?? 0);
const timeSpan = computed(() => Math.max(1, endTime.value - startTime.value));

const parsedSeries = computed(() => {
  const ts = times.value;
  return props.series.map((s) => {
    const points: { t: number; v: number }[] = [];
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i];
      if (v != null && Number.isFinite(v) && v > 0) {
        points.push({ t: ts[i], v });
      }
    }
    return { id: s.id, name: s.name, points };
  });
});

const interpolateAt = (points: { t: number; v: number }[], t: number): number | null => {
  if (!points.length) return null;
  if (t < points[0].t) return null;
  if (t >= points[points.length - 1].t) return points[points.length - 1].v;

  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].t <= t) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const i = Math.max(0, high);
  const p0 = points[i];
  const p1 = points[i + 1];
  if (!p1 || p1.t === p0.t) return p0.v;

  const ratio = (t - p0.t) / (p1.t - p0.t);
  if (props.log && p0.v > 0 && p1.v > 0) {
    return Math.exp(Math.log(p0.v) + ratio * (Math.log(p1.v) - Math.log(p0.v)));
  }
  return p0.v + ratio * (p1.v - p0.v);
};

const bounds = computed(() => {
  const all = parsedSeries.value.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return { min: 0, max: 1 };
  return { min: Math.min(...all), max: Math.max(...all) };
});

const currentTime = ref(0);
const playing = ref(false);
const speed = ref(1);
const SPEEDS = [0.5, 1, 2, 3];

const durationMs = computed(() => {
  const days = timeSpan.value / 86400000;
  return Math.min(90000, Math.max(30000, Math.round(days * 180)));
});

let rafId: number | undefined;
let lastRafTime: number | undefined;

const stop = () => {
  playing.value = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = undefined;
  }
  lastRafTime = undefined;
};

const tick = (now: number) => {
  if (!playing.value) return;
  if (lastRafTime == null) {
    lastRafTime = now;
  }
  const deltaRealMs = Math.max(0, now - lastRafTime);
  lastRafTime = now;

  const deltaHistMs = (deltaRealMs * speed.value / durationMs.value) * timeSpan.value;
  currentTime.value += deltaHistMs;

  if (currentTime.value >= endTime.value) {
    currentTime.value = endTime.value;
    stop();
    return;
  }

  rafId = requestAnimationFrame(tick);
};

const play = () => {
  if (currentTime.value >= endTime.value) {
    currentTime.value = startTime.value;
  }
  playing.value = true;
  lastRafTime = undefined;
  rafId = requestAnimationFrame(tick);
};

const toggle = () => (playing.value ? stop() : play());

const scrub = (e: Event) => {
  stop();
  currentTime.value = Number((e.target as HTMLInputElement).value);
};

const currentDateIso = computed(() =>
  new Date(currentTime.value).toISOString()
);

watch(
  [startTime, endTime],
  ([start, end]) => {
    if (currentTime.value < start || currentTime.value > end) {
      currentTime.value = start;
    }
  },
  { immediate: true }
);

onMounted(play);
onBeforeUnmount(stop);

const present = computed(() =>
  parsedSeries.value
    .map((s) => ({ ...s, value: interpolateAt(s.points, currentTime.value) }))
    .filter((s): s is { id: string; name: string; points: { t: number; v: number }[]; value: number } => s.value != null)
);

const chartHeight = computed(() =>
  props.vertical ? undefined : Math.max(224, parsedSeries.value.length * 26 + 40)
);

const option = computed(() => {
  const { min, max } = bounds.value;
  const names = present.value.map((s) => s.name);
  const valueAxis = {
    type: props.log ? "log" : "value",
    min: props.log ? 10 ** (Math.floor(Math.log10(min)) - 1) : 0,
    max: props.log ? 10 ** Math.ceil(Math.log10(max)) : max * 1.08,
    ...chart.axis(),
    axisLabel: {
      ...chart.axis().axisLabel,
      formatter: (v: number) => props.format(v),
    },
  };
  const categoryAxis = {
    type: "category",
    data: names,
    max: Math.max(0, names.length - 1),
    animationDuration: 0,
    animationDurationUpdate: 0,
    ...chart.axis(),
    ...(props.vertical
      ? { axisLabel: { ...chart.axis().axisLabel, interval: 0, rotate: 35 } }
      : {}),
    splitLine: { show: false },
  };
  return {
    ...chart.base(),
    animationDuration: 0,
    animationDurationUpdate: 0,
    grid: props.vertical
      ? { left: 8, right: 24, top: 24, bottom: 8, containLabel: true }
      : { left: 8, right: 72, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      ...chart.base().tooltip,
      trigger: "item",
      formatter: (p: any) => `${p.name}: ${props.format(p.value)}`,
    },
    ...(props.vertical
      ? { xAxis: categoryAxis, yAxis: valueAxis }
      : { xAxis: valueAxis, yAxis: { ...categoryAxis, inverse: true } }),
    series: [{
      type: "bar",
      realtimeSort: true,
      barMaxWidth: props.vertical ? 56 : 18,
      barCategoryGap: "30%",
      data: present.value.map((s) => ({
        value: s.value,
        itemStyle: { color: chart.runtimeColor(s.id, indexOf(s.id)) },
      })),
      label: {
        show: true,
        position: props.vertical ? "top" : "right",
        color: chart.text(),
        valueAnimation: false,
        formatter: (p: any) => props.format(p.value),
      },
    }],
  };
});
</script>

<template>
  <div class="replay">
    <div class="replay__controls">
      <button type="button" class="button replay__play"
        :aria-label="playing ? 'Pause replay' : 'Play replay'"
        @click="toggle">
        <Pause v-if="playing" :size="16" aria-hidden="true" />
        <Play v-else-if="currentTime < endTime" :size="16" aria-hidden="true" />
        <RotateCcw v-else :size="16" aria-hidden="true" />
      </button>
      <input class="replay__slider" type="range" :min="startTime" :max="endTime" step="any"
        :value="currentTime"
        aria-label="Point in time" @input="scrub" />
      <time class="replay__date"
        :datetime="currentDateIso">{{ fmtDate(currentDateIso) }}</time>
      <div class="segmented" role="group" aria-label="Replay speed">
        <button v-for="s in SPEEDS" :key="s" type="button"
          class="segmented__button"
          :data-state="speed === s ? 'active' : 'idle'"
          :aria-pressed="speed === s"
          @click="speed = s">{{ s }}×</button>
      </div>
    </div>
    <ChartBase :option="option" small :height="chartHeight"
      :label="`${label} over time, ${fmtDate(currentDateIso)}`" />
  </div>
</template>
