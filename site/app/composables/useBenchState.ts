import { CATEGORY_IDS } from "#shared/benchmarks";

export type SortKey = "name" | "category" | "fastest";

export const useBenchState = () => {
  const modes = useQueryState<string[]>("modes", []);
  return {
    host: useQueryState<string>("host", ""),
    baseline: useQueryState<string>("baseline", "scratch"),
    weights: useQueryState<"default" | "equal">("weights", "default"),
    modes,
    separate: computed(() => modes.value.length > 0),
    mode: useQueryState<"absolute" | "relative">("mode", "absolute"),
    log: useQueryState<boolean>("log", true),
    hidden: useQueryState<string[]>("hide", []),
    compareX: useQueryState<string>("x", "memory"),
    compareY: useQueryState<string>("y", "speed"),
    categories: useQueryState<string[]>("cat", []),
    search: useQueryState<string>("q", ""),
    sort: useQueryState<SortKey>("sort", "category"),
    desc: useQueryState<boolean>("desc", false),
    view: useQueryState<"table" | "cards">("view", "table"),
    range: useQueryState<"30d" | "90d" | "1y" | "all">("range", "90d"),
    open: useQueryState<string[]>("open", []),
    tab: useQueryState<"current" | "historical">("tab", "current"),
    mainMode: useQueryState<"absolute" | "relative">("mmode", "absolute"),
    trendRange: useQueryState<"30d" | "90d" | "1y" | "all">("trange", "90d"),
    parityRange: useQueryState<"30d" | "90d" | "1y" | "all">("prange", "all"),
  };
};

export const validCategories = (ids: string[]) =>
  ids.filter((id) => (CATEGORY_IDS as readonly string[]).includes(id));

export const useShown = () => {
  const { hidden, modes } = useBenchState();
  return (id: string) => {
    const base = id.split("~")[0]!;
    return !hidden.value.includes(base) &&
      (base === id || modes.value.includes(base));
  };
};
