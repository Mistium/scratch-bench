<script setup lang="ts">
import { use } from "echarts/core";
import { BarChart, LineChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TimelineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import VChart from "vue-echarts";

use([
  BarChart,
  LineChart,
  RadarChart,
  ScatterChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TimelineComponent,
  TooltipComponent,
  SVGRenderer,
]);

const emit = defineEmits<{ click: [event: any] }>();
defineProps<{
  option: Record<string, unknown>;
  label: string;
  small?: boolean;
  height?: number;
}>();
</script>

<template>
  <div class="chart-frame">
    <ClientOnly>
      <VChart class="chart" :class="{ 'chart--small': small }" :option="option"
        :style="height ? { height: `${height}px` } : undefined"
        :init-options="{ renderer: 'svg' }" autoresize role="img" @click="emit('click', $event)"
        :aria-label="label" />
      <template #fallback>
        <div class="chart chart--placeholder" :class="{ 'chart--small': small }"
          :style="height ? { height: `${height}px` } : undefined"
          data-state="loading" />
      </template>
    </ClientOnly>
  </div>
</template>
