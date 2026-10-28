const DAY = 86_400_000;

const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const ANCHOR = "2026-10-26";

export const schedule = (today: string): string[] => {
  const anchor = parse(ANCHOR);
  const end = Math.max(parse(today), anchor);
  const dates = new Set<number>();

  for (let x = anchor - 60 * DAY; x <= end; x += DAY) dates.add(x);
  const dailyStart = anchor - 60 * DAY;

  const weeklyStop = parse("2026-04-26");
  let x = dailyStart - 7 * DAY;
  while (x >= weeklyStop) {
    dates.add(x);
    x -= 7 * DAY;
  }

  const biweeklyStop = parse("2025-12-01");
  x = Math.min(...dates) - 14 * DAY;
  while (x >= biweeklyStop) {
    dates.add(x);
    x -= 14 * DAY;
  }

  for (
    const month of ["2025-11-01", "2025-10-01", "2025-09-01", "2025-08-01"]
  ) dates.add(parse(month));

  return [...dates].sort((a, b) => a - b).map(fmt);
};

export const timestampFor = (date: string): string => `${date}T03:00:00.000Z`;

export const endOfDay = (date: string): string => `${date}T23:59:59Z`;

/** One checkpoint every `days` days, counted back from `to`, not before `from`. */
export const everySchedule = (
  from: string,
  to: string,
  days: number,
): string[] => {
  const end = parse(to);
  const start = parse(from);
  if (start > end) return [];
  const dates: string[] = [];
  for (let x = end; x >= start; x -= days * DAY) dates.push(fmt(x));
  return dates.reverse();
};

/** The 1st of every month from `from` to `to`, plus `to` itself so the current versions are always included. */
export const monthlySchedule = (from: string, to: string): string[] => {
  const dates: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  if (fmt(d.getTime()) < from) d.setUTCMonth(d.getUTCMonth() + 1);
  for (; fmt(d.getTime()) <= to; d.setUTCMonth(d.getUTCMonth() + 1)) {
    dates.push(fmt(d.getTime()));
  }
  if (dates.at(-1) !== to) dates.push(to);
  return dates;
};

/**
 * Steadily less detailed the further back: walking back from `to`, each gap is a fixed share of how old the date is
 * (at least `minGap` days), so it is weekly near today and months apart years back. Goes back to `from`.
 */
export const fadingSchedule = (
  from: string,
  to: string,
  { share = 0.12, minGap = 7 } = {},
): string[] => {
  const end = parse(to);
  const start = parse(from);
  const dates: string[] = [];
  for (let x = end; x >= start;) {
    dates.push(fmt(x));
    const age = (end - x) / DAY;
    x -= Math.max(minGap, Math.round(age * share)) * DAY;
  }
  // Always start exactly at `from` (e.g. the day a fork began), not up to one wide gap after it.
  if (dates.at(-1) !== from && start <= end) dates.push(from);
  return dates.reverse();
};
