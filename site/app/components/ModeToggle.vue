<script setup lang="ts">
const props = defineProps<{ scope?: "main" }>();
const state = useBenchState();
const mode = props.scope === "main" ? state.mainMode : state.mode;
</script>

<template>
  <div class="segmented" role="group" aria-label="Value shown">
    <button type="button" class="segmented__button"
      :data-state="mode === 'absolute' ? 'active' : 'idle'"
      :aria-pressed="mode === 'absolute'" @click="mode = 'absolute'">
      Operations / ms
    </button>
    <button type="button" class="segmented__button"
      :data-state="mode === 'relative' ? 'active' : 'idle'"
      :aria-pressed="mode === 'relative'" @click="mode = 'relative'">
      Speedup
    </button>
  </div>
</template>
