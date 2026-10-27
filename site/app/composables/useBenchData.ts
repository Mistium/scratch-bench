import type { History, Latest, Meta, ScoreHistory } from "#shared/types";

const vmQuery = (separate: Ref<boolean>) => (separate.value ? "1" : undefined);

export const useMetaData = () => {
  const { separate } = useBenchState();
  return useFetch<Meta>("/api/meta", {
    key: "meta",
    query: computed(() => ({ vm: vmQuery(separate) })),
    watch: [separate],
  });
};

export const useLatestData = (host: Ref<string>) => {
  const { separate } = useBenchState();
  return useFetch<Latest>("/api/latest", {
    key: "latest",
    query: computed(() => ({
      host: host.value || undefined,
      vm: vmQuery(separate),
    })),
    watch: [host, separate],
  });
};

export const useScoreData = (host: Ref<string>, weights: Ref<string>) => {
  const { separate } = useBenchState();
  return useFetch<ScoreHistory>("/api/scores", {
    key: "scores",
    query: computed(() => ({
      host: host.value || undefined,
      weights: weights.value,
      vm: vmQuery(separate),
    })),
    watch: [host, weights, separate],
  });
};

const RANGE_DAYS = { "30d": 30, "90d": 90, "1y": 365, all: 0 } as const;
export type RangeKey = keyof typeof RANGE_DAYS;

export const rangeStart = (
  range: RangeKey,
  latest: string | null | undefined,
): string | undefined => {
  const days = RANGE_DAYS[range];
  if (!days || !latest) return undefined;
  return new Date(new Date(latest).getTime() - days * 86_400_000).toISOString();
};

export const useHistory = (
  ids: MaybeRefOrGetter<string[]>,
  host: Ref<string>,
  from: MaybeRefOrGetter<string | undefined>,
) => {
  const { separate } = useBenchState();
  return useAsyncData<History | null>(
    () =>
      `history:${toValue(ids).join(",")}:${host.value}:${
        toValue(from) ?? "all"
      }:${separate.value}`,
    () =>
      $fetch<History>("/api/history", {
        query: {
          host: host.value || undefined,
          from: toValue(from),
          bench: toValue(ids).join(",") || undefined,
          vm: vmQuery(separate),
        },
      }),
    {
      server: false,
      watch: [
        host,
        () => toValue(from),
        () => toValue(ids).join(","),
        separate,
      ],
      default: () => null,
    },
  );
};
