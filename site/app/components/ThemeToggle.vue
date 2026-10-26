<script setup lang="ts">
const { choice, cycle } = useTheme();
const labels = { system: "System", light: "Light", dark: "Dark" } as const;
</script>

<template>
  <button type="button" class="theme-toggle" :data-theme-choice="choice"
    :aria-label="`Theme: ${labels[choice]}. Click to change.`" @click="cycle">
    <span class="theme-toggle__label">{{ labels[choice] }}</span>
  </button>
</template>
