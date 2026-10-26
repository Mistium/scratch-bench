import { describe, expect, test } from "bun:test";
import { endOfDay, schedule, timestampFor } from "./schedule.ts";

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
