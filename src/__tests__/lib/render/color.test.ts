import { describe, expect, it } from "bun:test";

import { c, computeColorEnabled, stripAnsi } from "../../../lib/render/color";

describe("computeColorEnabled", () => {
  const base = {
    argv: [] as string[],
    env: {} as Record<string, string>,
    isTTY: true,
    mode: "text" as const,
  };

  it("returns false when --no-color flag is set", () => {
    expect(computeColorEnabled({ ...base, argv: ["--no-color"] })).toBe(false);
  });

  it("returns false when NO_COLOR env is set to any non-empty value", () => {
    expect(computeColorEnabled({ ...base, env: { NO_COLOR: "1" } })).toBe(false);
    expect(computeColorEnabled({ ...base, env: { NO_COLOR: "anything" } })).toBe(false);
  });

  it("returns true when FORCE_COLOR is set even without TTY", () => {
    expect(computeColorEnabled({ ...base, env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
  });

  it("--no-color wins over FORCE_COLOR", () => {
    expect(computeColorEnabled({ ...base, argv: ["--no-color"], env: { FORCE_COLOR: "1" } })).toBe(
      false,
    );
  });

  it("NO_COLOR wins over FORCE_COLOR", () => {
    expect(computeColorEnabled({ ...base, env: { NO_COLOR: "1", FORCE_COLOR: "1" } })).toBe(false);
  });

  it("FORCE_COLOR wins over TERM=dumb", () => {
    expect(computeColorEnabled({ ...base, env: { FORCE_COLOR: "1", TERM: "dumb" } })).toBe(true);
  });

  it("returns false when TERM=dumb", () => {
    expect(computeColorEnabled({ ...base, env: { TERM: "dumb" } })).toBe(false);
  });

  it("returns false in porcelain mode", () => {
    expect(computeColorEnabled({ ...base, mode: "porcelain" })).toBe(false);
  });

  it("returns false in json mode", () => {
    expect(computeColorEnabled({ ...base, mode: "json" })).toBe(false);
  });

  it("returns false when stdout is not a TTY", () => {
    expect(computeColorEnabled({ ...base, isTTY: false })).toBe(false);
  });

  it("returns true in text mode with TTY and no overrides", () => {
    expect(computeColorEnabled(base)).toBe(true);
  });

  it("returns false in porcelain mode even with FORCE_COLOR", () => {
    expect(computeColorEnabled({ ...base, mode: "porcelain", env: { FORCE_COLOR: "1" } })).toBe(
      false,
    );
  });

  it("returns false in json mode even with FORCE_COLOR", () => {
    expect(computeColorEnabled({ ...base, mode: "json", env: { FORCE_COLOR: "1" } })).toBe(false);
  });
});

describe("c.* wrappers", () => {
  it("wraps with ANSI codes when enabled", () => {
    const wrapped = c.red("hello", true);
    expect(wrapped).toBe("\x1b[31mhello\x1b[39m");
  });

  it("returns input unchanged when disabled", () => {
    expect(c.red("hello", false)).toBe("hello");
    expect(c.cyan("hello", false)).toBe("hello");
    expect(c.yellow("hello", false)).toBe("hello");
    expect(c.bold("hello", false)).toBe("hello");
    expect(c.dim("hello", false)).toBe("hello");
  });

  it("composes (bold + red)", () => {
    expect(c.bold(c.red("err", true), true)).toBe("\x1b[1m\x1b[31merr\x1b[39m\x1b[22m");
  });
});

describe("stripAnsi", () => {
  it("removes color escape codes", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[39m")).toBe("hello");
    expect(stripAnsi("\x1b[1m\x1b[31mhello\x1b[39m\x1b[22m")).toBe("hello");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});
