import { BENCHMARK_BY_ID } from "../../shared/benchmarks.ts";
import type { WeightMode } from "../../shared/scoring.ts";

const one = (
  v: unknown,
):
  | string
  | undefined => (Array.isArray(v)
    ? String(v[0])
    : typeof v === "string"
    ? v
    : undefined);

export const hostParam = (q: Record<string, unknown>) => {
  const v = one(q.host);
  return v && /^h[0-9a-f]{8}$/.test(v) ? v : undefined;
};

export const runtimeParam = (q: Record<string, unknown>, key: string) => {
  const v = one(q[key]);
  return v && /^[a-z0-9-]{1,40}$/.test(v) ? v : undefined;
};

export const weightsParam = (
  q: Record<string, unknown>,
): WeightMode => (one(q.weights) === "equal" ? "equal" : "default");

export const dateParam = (
  q: Record<string, unknown>,
  key: string,
  endOfDay = false,
) => {
  const v = one(q[key]);
  if (!v) return undefined;
  const t = Date.parse(
    endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v,
  );
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

export const benchParam = (q: Record<string, unknown>) => {
  const v = one(q.bench);
  return v ? v.split(",").filter((id) => BENCHMARK_BY_ID[id]) : undefined;
};
