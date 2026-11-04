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

const filled = computed(() =>
  props.series.map((s) => {
    let last: number | null = null;
    return {
      ...s,
      values: s.values.map((v) => (last = v != null && v > 0 ? v : last)),
    };
  })
);

const bounds = computed(() => {
  const all = filled.value.flatMap((s) => s.values).filter((v): v is number =>
    v != null
  );
  if (!all.length) return { min: 0, max: 1 };
  return { min: Math.min(...all), max: Math.max(...all) };
});

const last = computed(() => Math.max(0, props.timestamps.length - 1));
const frame = ref(0);
const playing = ref(false);
const speed = ref(1);
const SPEEDS = [0.5, 1, 2, 4];

const baseMs = computed(() =>
  Math.min(500, Math.max(80, 15000 / Math.max(1, props.timestamps.length)))
);
const stepMs = computed(() => baseMs.value / speed.value);

let timer: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  playing.value = false;
  clearTimeout(timer);
};
const tick = () => {
  if (!playing.value) return;
  if (frame.value >= last.value) return stop();
  frame.value++;
  timer = setTimeout(tick, stepMs.value);
};
const play = () => {
  if (frame.value >= last.value) frame.value = 0;
  playing.value = true;
  clearTimeout(timer);
  timer = setTimeout(tick, stepMs.value);
};
const toggle = () => (playing.value ? stop() : play());
const scrub = (e: Event) => {
  stop();
  frame.value = Number((e.target as HTMLInputElement).value);
};
onMounted(play);
onBeforeUnmount(stop);
watch(() => props.timestamps.length, () => {
  frame.value = Math.min(frame.value, last.value);
});

const present = computed(() =>
  filled.value
    .map((s) => ({ ...s, value: s.values[frame.value] ?? null }))
    .filter((s) => s.value != null)
);

const chartHeight = computed(() =>
  props.vertical ? undefined : Math.max(224, filled.value.length * 26 + 40)
);

const option = computed(() => {
  const dur = Math.round(stepMs.value);
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
    animationDuration: dur,
    animationDurationUpdate: dur,
    ...chart.axis(),
    ...(props.vertical
      ? { axisLabel: { ...chart.axis().axisLabel, interval: 0, rotate: 35 } }
      : {}),
    splitLine: { show: false },
  };
  return {
    ...chart.base(),
    animationDuration: 0,
    animationDurationUpdate: dur,
    animationEasing: "linear",
    animationEasingUpdate: "linear",
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
        valueAnimation: true,
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
        <Play v-else-if="frame < last" :size="16" aria-hidden="true" />
        <RotateCcw v-else :size="16" aria-hidden="true" />
      </button>
      <input class="replay__slider" type="range" min="0" :max="last" step="1"
        :value="frame"
        aria-label="Point in time" @input="scrub" />
      <time class="replay__date"
        :datetime="timestamps[frame]">{{ fmtDate(timestamps[frame]) }}</time>
      <div class="segmented" role="group" aria-label="Replay speed">
        <button v-for="s in SPEEDS" :key="s" type="button"
          class="segmented__button"
          :data-state="speed === s ? 'active' : 'idle'"
          :aria-pressed="speed === s"
          @click="speed = s">{{ s }}×</button>
      </div>
    </div>
    <ChartBase :option="option" small :height="chartHeight"
      :label="`${label} over time, ${fmtDate(timestamps[frame])}`" />
  </div>
</template>
