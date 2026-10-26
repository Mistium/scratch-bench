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
