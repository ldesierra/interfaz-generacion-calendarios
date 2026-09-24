import { describe, expect, it } from "vitest";
import { computeDiaIds, diasToCsv } from "./dias";

function d(day: number) {
  return new Date(2026, 0, day);
}

describe("computeDiaIds", () => {
  it("starts at 1 for the earliest date", () => {
    expect(computeDiaIds([d(5)])).toEqual([1]);
  });

  it("increments by 1 for consecutive days", () => {
    expect(computeDiaIds([d(1), d(2), d(3)])).toEqual([1, 2, 3]);
  });

  it("skips ids for gaps, matching the sample dias.csv", () => {
    // Selección: 1, 3-4, 6-8, 10-13 (huecos en 2, 5, 9).
    const dates = [d(1), d(3), d(4), d(6), d(7), d(8), d(10), d(11), d(12), d(13)];
    expect(computeDiaIds(dates)).toEqual([1, 3, 4, 6, 7, 8, 10, 11, 12, 13]);
  });

  it("sorts unordered input chronologically before assigning ids", () => {
    expect(computeDiaIds([d(4), d(1), d(3)])).toEqual([1, 3, 4]);
  });
});

describe("diasToCsv", () => {
  it("renders the id column with a trailing newline", () => {
    expect(diasToCsv([d(1), d(3), d(4)])).toBe("id\n1\n3\n4\n");
  });
});
