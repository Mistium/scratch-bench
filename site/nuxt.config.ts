const cron = process.env.BENCH_CRON ?? "0 3 * * *";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  build: { transpile: ["vue-echarts", "echarts", "zrender"] },
  nitro: {
    experimental: { tasks: true },
    scheduledTasks: { [cron]: ["bench:nightly"] },
  },
  runtimeConfig: {
    benchSchedule: cron,
  },
  app: {
    head: {
      title: "Scratch runtime benchmarks",
      htmlAttrs: { lang: "en" },
      meta: [{
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      }],
    },
  },
});
