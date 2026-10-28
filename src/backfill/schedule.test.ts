import { describe, expect, test } from "bun:test";
import { endOfDay, schedule, timestampFor, everySchedule, fadingSchedule, monthlySchedule } from "./schedule.ts";

const dates = schedule("2026-10-26");

describe("schedule", () => {
  test("has 92 distinct, ascending dates from August 2025 to today", () => {
    expect(dates.length).toBe(92);
    expect(new Set(dates).size).toBe(92);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]).toBe("2025-08-01");
    expect(dates.at(-1)).toBe("2026-10-26");
  });

  test("is daily for the last two months", () => {
    const daily = dates.filter((d) => d >= "2026-08-27");
    expect(daily.length).toBe(61);
    expect(daily[0]).toBe("2026-08-27");
    for (let i = 1; i < daily.length; i++) {
      expect((Date.parse(daily[i]!) - Date.parse(daily[i - 1]!)) / 86_400_000)
        .toBe(1);
    }
  });

  test("is weekly for the four months before that", () => {
    const weekly = dates.filter((d) => d >= "2026-04-27" && d < "2026-08-27");
    expect(weekly.length).toBe(17);
    expect(weekly[0]).toBe("2026-04-30");
    expect(weekly.at(-1)).toBe("2026-08-20");
    for (let i = 1; i < weekly.length; i++) {
      expect((Date.parse(weekly[i]!) - Date.parse(weekly[i - 1]!)) / 86_400_000)
        .toBe(7);
    }
  });

  test("is every two weeks back to December, then monthly back to August", () => {
    const biweekly = dates.filter((d) => d >= "2025-12-01" && d < "2026-04-27");
    expect(biweekly.length).toBe(10);
    expect(biweekly[0]).toBe("2025-12-11");
    for (let i = 1; i < biweekly.length; i++) {
      expect(
        (Date.parse(biweekly[i]!) - Date.parse(biweekly[i - 1]!)) / 86_400_000,
      ).toBe(14);
    }
    expect(dates.filter((d) => d < "2025-12-01")).toEqual([
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
    ]);
  });

  test("only the daily zone grows as days pass; older dates never shift", () => {
    const later = schedule("2026-10-29");
    expect(later.length).toBe(92 + 3);
    expect(later.slice(0, 92)).toEqual(dates);
    expect(later.slice(92)).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);
  });

  test("never looks into the future of the anchor with an earlier today", () => {
    expect(schedule("2026-09-01")).toEqual(dates);
  });
});

describe("timestamps", () => {
  test("results are recorded at the nightly run time", () => {
    expect(timestampFor("2026-08-27")).toBe("2026-08-27T03:00:00.000Z");
    expect(endOfDay("2026-08-27")).toBe("2026-08-27T23:59:59Z");
  });
});

describe("everySchedule", () => {
  test("gives one checkpoint every seven days, ending today", () => {
    const weekly = everySchedule("2025-10-27", "2026-10-27", 7);
    expect(weekly.length).toBe(53);
    expect(weekly[0]).toBe("2025-10-28");
    expect(weekly.at(-1)).toBe("2026-10-27");
    for (let i = 1; i < weekly.length; i++) {
      const gap = (Date.parse(weekly[i]!) - Date.parse(weekly[i - 1]!)) /
        86_400_000;
      expect(gap).toBe(7);
    }
  });

  test("never goes before the requested start", () => {
    expect(everySchedule("2026-10-01", "2026-10-27", 7)).toEqual([
      "2026-10-06",
      "2026-10-13",
      "2026-10-20",
      "2026-10-27",
    ]);
  });
});

describe("monthlySchedule", () => {
  test("is the 1st of each month, plus the last day so current versions are included", () => {
    expect(monthlySchedule("2025-08-01", "2025-11-12")).toEqual([
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-11-12",
    ]);
  });

  test("starts at the next month when `from` is mid-month, and does not repeat a last day that is the 1st", () => {
    expect(monthlySchedule("2025-08-15", "2025-10-01")).toEqual([
      "2025-09-01",
      "2025-10-01",
    ]);
  });
});

describe("fadingSchedule", () => {
  const dates = fadingSchedule("2021-10-27", "2026-10-27");
  const gapAt = (d: string) => {
    const i = dates.findIndex((x) => x >= d);
    return (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000;
  };

  test("ends today and starts exactly at `from`", () => {
    expect(dates.at(-1)).toBe("2026-10-27");
    expect(dates[0]).toBe("2021-10-27");
  });

  test("gets steadily less detailed going back", () => {
    expect(gapAt("2026-10-20")).toBe(7);
    expect(gapAt("2026-04-01")).toBeGreaterThan(gapAt("2026-09-01"));
    expect(gapAt("2025-01-01")).toBeGreaterThan(gapAt("2026-04-01"));
    expect(gapAt("2023-01-01")).toBeGreaterThan(gapAt("2025-01-01"));
    // (from the second gap on: the first one ends at `from`, so it can be shorter)
    for (let i = 3; i < dates.length; i++) {
      const later = Date.parse(dates[i]!) - Date.parse(dates[i - 1]!);
      const earlier = Date.parse(dates[i - 1]!) - Date.parse(dates[i - 2]!);
      expect(earlier).toBeGreaterThanOrEqual(later);
    }
  });

  test("stays a manageable number of checkpoints", () => {
    expect(dates.length).toBeLessThan(60);
  });
});
