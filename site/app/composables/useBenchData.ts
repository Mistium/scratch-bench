import type { History, Latest, Meta, ScoreHistory } from "#shared/types";

export const useMetaData = () => useFetch<Meta>("/api/meta", { key: "meta" });

export const useLatestData = (host: Ref<string>) =>
  useFetch<Latest>("/api/latest", {
    key: "latest",
    query: computed(() => ({ host: host.value || undefined })),
    watch: [host],
  });

export const useScoreData = (host: Ref<string>, weights: Ref<string>) =>
  useFetch<ScoreHistory>("/api/scores", {
    key: "scores",
    query: computed(() => ({
      host: host.value || undefined,
      weights: weights.value,
    })),
    watch: [host, weights],
  });

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
) =>
  useAsyncData<History | null>(
    () =>
      `history:${toValue(ids).join(",")}:${host.value}:${
        toValue(from) ?? "all"
      }`,
    () =>
      $fetch<History>("/api/history", {
        query: {
          host: host.value || undefined,
          from: toValue(from),
          bench: toValue(ids).join(",") || undefined,
        },
      }),
    {
      server: false,
      watch: [host, () => toValue(from), () => toValue(ids).join(",")],
      default: () => null,
    },
  );
