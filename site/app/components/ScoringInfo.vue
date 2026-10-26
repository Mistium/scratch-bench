<script setup lang="ts">
import { CATEGORIES, CATEGORY_IDS } from "#shared/benchmarks";

const { weights } = useBenchState();
const { data: meta } = await useMetaData();
</script>

<template>
  <details class="scoring-info">
    <summary class="scoring-info__summary">How the scores work</summary>
    <div class="scoring-info__body">
      <p>
        Every benchmark reports how many operations it completed per millisecond. A category's score is the geometric mean of its
        benchmarks' results, and Overall Performance is the geometric mean of the category scores, weighted as in the table below
        (every weight is 1 when the weighting is switched off in the header). A geometric mean is
        used because results span several orders of magnitude and one huge number must not decide the outcome.
      </p>
      <p>
        Scores are raw numbers, so they depend on the machine they were measured on: compare scores from the same machine (the
        machine selector does that for you), and use the speedup columns to compare runtimes within a benchmark. A runtime that
        is missing more than 20% of a category's benchmarks gets no score for it, and so no overall score. When the benchmarks
        themselves are revised, scores before and after the change are not comparable; charts mark those points.
      </p>
      <table class="table scoring-info__table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" class="table__number">Weight</th>
            <th scope="col">What it covers</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in CATEGORY_IDS" :key="c">
            <th scope="row">{{ CATEGORIES[c].label }}</th>
            <td
              class="table__number">{{ weights === "default" ? CATEGORIES[c].weight : 1 }}</td>
            <td>{{ CATEGORIES[c].description }}</td>
          </tr>
        </tbody>
      </table>
      <p
        class="scoring-info__note">Scoring version {{ meta?.scoreVersion }}.</p>
    </div>
  </details>
</template>
