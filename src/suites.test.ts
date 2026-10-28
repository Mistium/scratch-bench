import { expect, test } from "bun:test";
import { parity } from "./suites.ts";

test("a parity run that stopped early counts the groups that reported", () => {
  const lines = [
    "[PASSED] Motion: Move Steps: 10/10 (100%)",
    "[FAILED] Data: List Limit: 3/6 (50%)",
    "┗ Test 1 Failed",
  ];
  expect(parity.partial!(lines)).toEqual({
    verdict: "failed",
    passed: 13,
    total: 16,
    failed_groups: [{ name: "Data: List Limit", passed: 3, total: 6 }],
    incomplete: true,
  });
});

test("a finished parity run is read as usual, and output with no groups gives nothing", () => {
  const done = parity.partial!(["[PASSED] All Tests Were Successful: 2123/2123 (100%)"])!;
  expect([done.verdict, done.passed, done.total, done.incomplete]).toEqual(["passed", 2123, 2123, undefined]);
  expect(parity.partial!(["starting up"])).toBeUndefined();
});
