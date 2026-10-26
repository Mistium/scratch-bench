<template>
  <section class="empty-state">
    <h2 class="empty-state__title">No benchmark results yet</h2>
    <p class="empty-state__text">
      The site reads the runner's results directory. Run <code>bun run bench</code> in the repo, or point the site at an
      existing results directory with <code>BENCH_RESULTS_DIR</code>. The nightly task fills it automatically.
    </p>
  </section>
</template>
