<script setup lang="ts">
import { History, X } from "lucide-vue-next";

const on = defineModel<boolean>({ default: false });
</script>

<template>
  <button type="button" class="button replay__toggle" :data-state="on ? 'active' : 'idle'" :aria-pressed="on"
    title="Watch this chart change over time" @click="on = !on">
    <X v-if="on" :size="16" aria-hidden="true" />
    <History v-else :size="16" aria-hidden="true" />
    {{ on ? "Back to now" : "Replay history" }}
  </button>
</template>
