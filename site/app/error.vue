<script setup lang="ts">
defineProps<{ error: { statusCode: number; statusMessage?: string } }>();
</script>

<template>
  <div class="page">
    <main class="page__main error-page">
      <h1 class="error-page__title">{{ error.statusCode }}</h1>
      <p
        class="error-page__text">{{ error.statusMessage || "Something went wrong." }}</p>
      <NuxtLink to="/" class="button"
        @click="clearError()">Back to the overview</NuxtLink>
    </main>
  </div>
</template>
