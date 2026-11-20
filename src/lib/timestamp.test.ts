import { describe, expect, it } from "vitest";
import { formatBytes, formatTimestamp, parseTimestamp } from "./timestamp";

describe("parseTimestamp", () => {
  it.each([
    ["0:00", 0],
    ["1:05", 65],
    ["01:05", 65],
    ["1:05.5", 65.5],
    ["1:02:03", 3723],
    ["65", 65],
    [" 2:30 ", 150],
  ])("parses %j → %d", (input, expected) => {
    expect(parseTimestamp(input)).toBe(expected);
  });

  it.each(["", "1:5", "abc", "1:65", "-5", "-1:05", "1:", ":05", "1:02:65", "1:60:00", "1.2.3"])(
    "rejects %j",
    (input) => {
      expect(parseTimestamp(input)).toBeNull();
    },
  );
});

describe("formatTimestamp", () => {
  it("formats whole seconds by default", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });

  it("rounds to the nearest second at precision 0", () => {
    expect(formatTimestamp(64.4)).toBe("1:04");
    expect(formatTimestamp(64.5)).toBe("1:05");
    expect(formatTimestamp(59.6)).toBe("1:00");
  });

  it("rounds to tenths at precision 1", () => {
    expect(formatTimestamp(65.34, 1)).toBe("1:05.3");
    expect(formatTimestamp(65.35, 1)).toBe("1:05.4");
    expect(formatTimestamp(59.96, 1)).toBe("1:00.0");
    expect(formatTimestamp(5, 1)).toBe("0:05.0");
  });

  it("treats negative and non-finite values as 0", () => {
    expect(formatTimestamp(-3)).toBe("0:00");
    expect(formatTimestamp(Number.NaN, 1)).toBe("0:00.0");
  });
});

describe("formatBytes", () => {
  const KB = 1024;
  const MB = 1024 ** 2;
  const GB = 1024 ** 3;

  it("handles the boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(999 * KB)).toBe("999 KB");
    expect(formatBytes(MB - 1)).toBe("1 MB");
    expect(formatBytes(MB)).toBe("1 MB");
    expect(formatBytes(1.5 * GB)).toBe("1.5 GB");
  });

  it("formats the limit and the D10 example", () => {
    expect(formatBytes(500 * MB)).toBe("500 MB");
    expect(formatBytes(640 * MB)).toBe("640 MB");
  });
});
