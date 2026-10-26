import type { Meta } from "#shared/types";

export const useRuntimes = (
  meta: Ref<Meta | null | undefined>,
  baseline: Ref<string>,
) => {
  const ordered = computed(() => {
    const all = meta.value?.runtimes ?? [];
    return [...all].sort((a, b) =>
      Number(b.id === baseline.value) - Number(a.id === baseline.value)
    );
  });
  const nameOf = (id: string) =>
    meta.value?.runtimes.find((r) => r.id === id)?.name ?? id;
  const indexOf = (id: string) =>
    Math.max(0, (meta.value?.runtimes ?? []).findIndex((r) => r.id === id));
  return { ordered, nameOf, indexOf };
};
