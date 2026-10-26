<script setup lang="ts">
import {
  type Benchmark,
  BENCHMARKS,
  CATEGORIES,
  CATEGORY_IDS,
} from "#shared/benchmarks";

const {
  host,
  baseline,
  weights,
  mode,
  hidden,
  categories,
  search,
  sort,
  desc,
  view,
  open,
  log,
} = useBenchState();
const { data: meta } = await useMetaData();
const { data: latest } = await useLatestData(host);
const { nameOf } = useRuntimes(meta, baseline);
const { value, text } = useValues(latest, baseline, mode);

const ranked = useRankedRuntimeIds(host, weights);
const runtimeIds = computed(() => {
  const present = new Set((latest.value?.runtimes ?? []).map((r) => r.id));
  const ordered = [
    ...ranked.value,
    ...[...present].filter((id) => !ranked.value.includes(id)),
  ];
  return ordered.filter((id) => present.has(id) && !hidden.value.includes(id));
});

const bestOf = (id: string): string | null => {
  let best: string | null = null;
  let top = -Infinity;
  for (const rt of runtimeIds.value) {
    const v = value(rt, id);
    if (v != null && v > top) {
      top = v;
      best = rt;
    }
  }
  return best;
};

const searchTokens = computed(() =>
  search.value.toLowerCase().split(/\s+/).filter(Boolean)
);

const matches = (b: Benchmark) => {
  if (categories.value.length && !categories.value.includes(b.category)) {
    return false;
  }
  if (!searchTokens.value.length) return true;
  const haystack = `${b.label} ${b.id} ${b.description} ${
    CATEGORIES[b.category].label
  } ${b.unit}`.toLowerCase();
  return searchTokens.value.every((t) => haystack.includes(t));
};

const rows = computed(() => {
  const list = BENCHMARKS.filter(matches).map((b) => ({
    bench: b,
    best: bestOf(b.id),
    bestValue: bestOf(b.id) ? value(bestOf(b.id)!, b.id) : null,
  }));
  const order = (a: (typeof list)[number], b: (typeof list)[number]) => {
    switch (sort.value) {
      case "name":
        return a.bench.label.localeCompare(b.bench.label);
      case "fastest":
        return (b.bestValue ?? -1) - (a.bestValue ?? -1);
      default:
        return CATEGORY_IDS.indexOf(a.bench.category) -
          CATEGORY_IDS.indexOf(b.bench.category);
    }
  };
  list.sort(order);
  return desc.value ? list.reverse() : list;
});

const toggleOpen = (id: string) => {
  open.value = open.value.includes(id)
    ? open.value.filter((x) => x !== id)
    : [...open.value, id];
};
const toggleCategory = (id: string) => {
  categories.value = categories.value.includes(id)
    ? categories.value.filter((x) => x !== id)
    : [...categories.value, id];
};
const reset = () => {
  search.value = "";
  categories.value = [];
  hidden.value = [];
  sort.value = "category";
  desc.value = false;
};
const filtered = computed(() =>
  search.value !== "" || categories.value.length > 0 || hidden.value.length > 0
);

const sortOptions = [
  { id: "category", label: "Category" },
  { id: "name", label: "Name" },
  { id: "fastest", label: "Fastest result" },
] as const;
</script>

<template>
  <section id="advanced" class="advanced" aria-labelledby="advanced-title">
    <header class="advanced__header">
      <h2 id="advanced-title" class="advanced__title">Advanced</h2>
    </header>

    <div class="toolbar" role="search">
      <label class="field field--search">
        <span class="visually-hidden">Search benchmarks</span>
        <input v-model="search" type="search" class="field__input"
          placeholder="Search benchmarks (try: list, sort, scheduler)"
          autocomplete="off" />
      </label>

      <div class="chips" role="group" aria-label="Categories">
        <button
          v-for="c in CATEGORY_IDS"
          :key="c"
          type="button"
          class="chip"
          :data-category="c"
          :data-state="categories.includes(c) ? 'active' : 'idle'"
          :aria-pressed="categories.includes(c)"
          @click="toggleCategory(c)"
        >
          {{ CATEGORIES[c].label }}
        </button>
      </div>

      <RuntimeChips />

      <div class="toolbar__row">
        <label class="field">
          <span class="field__label">Sort by</span>
          <select v-model="sort" class="field__select">
            <option v-for="o in sortOptions" :key="o.id"
              :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <button type="button" class="button" :aria-pressed="desc"
          :data-state="desc ? 'active' : 'idle'" @click="desc = !desc">
          Reverse order
        </button>
        <ModeToggle />
        <label class="field field--check">
          <input v-model="log" type="checkbox" class="field__checkbox" />
          <span class="field__label">Logarithmic charts</span>
        </label>
        <div class="segmented" role="group" aria-label="Layout">
          <button type="button" class="segmented__button"
            :data-state="view === 'table' ? 'active' : 'idle'"
            :aria-pressed="view === 'table'"
            @click="view = 'table'">Table</button>
          <button type="button" class="segmented__button"
            :data-state="view === 'cards' ? 'active' : 'idle'"
            :aria-pressed="view === 'cards'"
            @click="view = 'cards'">Cards</button>
        </div>
        <button v-if="filtered" type="button" class="button"
          @click="reset">Clear filters</button>
      </div>
    </div>

    <p class="advanced__count"
      role="status">Showing {{ rows.length }} of {{ BENCHMARKS.length }} benchmarks</p>

    <p v-if="!rows.length" class="advanced__empty"
      data-state="empty">No benchmark matches these filters.</p>

    <div v-else-if="view === 'table'" class="table-scroll">
      <table class="table table--benchmarks">
        <thead>
          <tr>
            <th scope="col">Benchmark</th>
            <th v-for="id in runtimeIds" :key="id" scope="col"
              class="table__number" :data-runtime="id">
              <span class="runtime-dot" :data-runtime="id" /> {{ nameOf(id) }}
            </th>
          </tr>
        </thead>
        <BenchmarkRow
          v-for="r in rows"
          :key="r.bench.id"
          :bench="r.bench"
          :runtime-ids="runtimeIds"
          :expanded="open.includes(r.bench.id)"
          :text="text"
          :best="r.best"
          @toggle="toggleOpen(r.bench.id)"
        />
      </table>
    </div>

    <div v-else class="card-grid card-grid--advanced">
      <article v-for="r in rows" :key="r.bench.id" class="bench-card"
        :data-category="r.bench.category"
        :data-state="open.includes(r.bench.id) ? 'open' : 'closed'">
        <header class="bench-card__header">
          <h3 class="bench-card__title">
            <button type="button" class="bench-row__toggle"
              :aria-expanded="open.includes(r.bench.id)"
              @click="toggleOpen(r.bench.id)">{{ r.bench.label }}</button>
          </h3>
          <p class="bench-card__text">
            <span class="badge"
              :data-category="r.bench.category">{{ CATEGORIES[r.bench.category].label }}</span>
            <code class="bench-row__id">{{ r.bench.id }}</code>
          </p>
        </header>
        <ul class="bar-list">
          <li v-for="id in runtimeIds" :key="id" class="bar-list__item"
            :data-runtime="id" :data-best="r.best === id">
            <span
              class="bar-list__name"><span class="runtime-dot" :data-runtime="id" /> {{ nameOf(id) }}</span>
            <span class="bar-list__value">{{ text(id, r.bench.id) }}</span>
          </li>
        </ul>
        <BenchmarkPanel v-if="open.includes(r.bench.id)" :id="r.bench.id" />
      </article>
    </div>
  </section>
</template>
