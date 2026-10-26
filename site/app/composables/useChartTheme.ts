const FALLBACK = [
  "#2f5fd0",
  "#d1672b",
  "#1f8a70",
  "#8a45c4",
  "#c2a000",
  "#1e90b8",
  "#c2447a",
  "#6b7280",
];

export const useChartTheme = () => {
  const { resolved } = useTheme();
  const version = useState("chart-theme-version", () => 0);

  if (import.meta.client) {
    onMounted(() => version.value++);
    watch(resolved, () => nextTick(() => version.value++));
  }

  const css = (name: string, fallback = ""): string => {
    void version.value;
    if (!import.meta.client) return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name)
      .trim() || fallback;
  };

  const runtimeColor = (id: string, index = 0): string =>
    css(`--runtime-${id}`) ||
    css(`--chart-${(index % 8) + 1}`, FALLBACK[index % 8]);

  return {
    css,
    runtimeColor,
    text: () => css("--chart-text", "#15181d"),
    muted: () => css("--chart-muted", "#5b6472"),
    grid: () => css("--chart-grid", "#e3e6eb"),
    tooltipBg: () => css("--chart-tooltip-bg", "#fff"),
    tooltipBorder: () => css("--chart-tooltip-border", "#d9dde4"),
    palette: () =>
      Array.from({ length: 8 }, (_, i) => css(`--chart-${i + 1}`, FALLBACK[i])),
    narrow: (option: Record<string, unknown>) => ({
      baseOption: option,
      media: [{
        query: { maxWidth: 560 },
        option: {
          legend: { top: 0, bottom: "auto" },
          grid: { top: 88, bottom: 44 },
        },
      }],
    }),
    base: () => ({
      textStyle: {
        color: css("--chart-text", "#15181d"),
        fontFamily: css("--font-sans", "sans-serif"),
      },
      tooltip: {
        backgroundColor: css("--chart-tooltip-bg", "#fff"),
        borderColor: css("--chart-tooltip-border", "#d9dde4"),
        textStyle: { color: css("--chart-text", "#15181d") },
      },
      legend: { textStyle: { color: css("--chart-muted", "#5b6472") } },
    }),
    axis: () => ({
      axisLine: { lineStyle: { color: css("--chart-grid", "#e3e6eb") } },
      axisLabel: { color: css("--chart-muted", "#5b6472"), hideOverlap: true },
      splitLine: { lineStyle: { color: css("--chart-grid", "#e3e6eb") } },
      nameTextStyle: { color: css("--chart-muted", "#5b6472") },
    }),
  };
};
