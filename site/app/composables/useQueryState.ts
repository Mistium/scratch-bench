type Value = string | number | boolean | string[];

const parse = <T extends Value>(
  raw: string | null | undefined,
  fallback: T,
): T => {
  if (raw == null || raw === "") return fallback;
  if (typeof fallback === "boolean") {
    return (raw === "1" || raw === "true") as T;
  }
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (Array.isArray(fallback)) return raw.split(",").filter(Boolean) as T;
  return raw as T;
};

const serialize = (v: Value): string => {
  if (typeof v === "boolean") return v ? "1" : "0";
  if (Array.isArray(v)) return v.join(",");
  return String(v);
};

const same = (a: Value, b: Value) => serialize(a) === serialize(b);

export const useQueryState = <T extends Value>(key: string, fallback: T) => {
  const route = useRoute();
  const router = useRouter();
  return computed<T>({
    get() {
      const raw = route.query[key];
      return parse(Array.isArray(raw) ? raw[0] : raw, fallback);
    },
    set(value) {
      const query = { ...route.query };
      if (same(value, fallback)) delete query[key];
      else query[key] = serialize(value);
      router.replace({ query });
    },
  });
};
