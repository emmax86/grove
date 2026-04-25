import { describe, expect, it } from "bun:test";

import { resolveRenderContext } from "../../../lib/render/flags";

const env = { LANG: "en_US.UTF-8" };

describe("resolveRenderContext", () => {
  it("default is text mode with TTY", () => {
    const ctx = resolveRenderContext({ argv: [], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.mode).toBe("text");
      expect(ctx.value.colorEnabled).toBe(true);
      expect(ctx.value.unicodeEnabled).toBe(true);
    }
  });

  it("--porcelain selects porcelain mode and disables color", () => {
    const ctx = resolveRenderContext({
      argv: ["--porcelain"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.mode).toBe("porcelain");
      expect(ctx.value.colorEnabled).toBe(false);
    }
  });

  it("--json selects json mode and disables color", () => {
    const ctx = resolveRenderContext({ argv: ["--json"], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.mode).toBe("json");
      expect(ctx.value.colorEnabled).toBe(false);
    }
  });

  it("--text selects text mode explicitly", () => {
    const ctx = resolveRenderContext({ argv: ["--text"], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.mode).toBe("text");
    }
  });

  it("--porcelain --json is INVALID_FLAGS", () => {
    const ctx = resolveRenderContext({
      argv: ["--porcelain", "--json"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(false);
    if (!ctx.ok) {
      expect(ctx.code).toBe("INVALID_FLAGS");
    }
  });

  it("--text --json is INVALID_FLAGS", () => {
    const ctx = resolveRenderContext({
      argv: ["--text", "--json"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(false);
    if (!ctx.ok) {
      expect(ctx.code).toBe("INVALID_FLAGS");
    }
  });

  it("--text --porcelain is INVALID_FLAGS", () => {
    const ctx = resolveRenderContext({
      argv: ["--text", "--porcelain"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(false);
  });

  it("--no-color disables color in text mode", () => {
    const ctx = resolveRenderContext({ argv: ["--no-color"], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.colorEnabled).toBe(false);
    }
  });

  it("--ascii disables unicode", () => {
    const ctx = resolveRenderContext({ argv: ["--ascii"], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.unicodeEnabled).toBe(false);
    }
  });
});

describe("resolveRenderContext warnings", () => {
  it("warns when --no-color is used with --porcelain", () => {
    const ctx = resolveRenderContext({
      argv: ["--porcelain", "--no-color"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.warnings).toContain("--no-color is ignored outside text mode");
    }
  });

  it("warns when --ascii is used with --json", () => {
    const ctx = resolveRenderContext({
      argv: ["--json", "--ascii"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.warnings).toContain("--ascii is ignored outside text mode");
    }
  });

  it("no warnings when --no-color and --ascii are used in text mode", () => {
    const ctx = resolveRenderContext({
      argv: ["--no-color", "--ascii"],
      env,
      isTTY: true,
      isStderrTTY: true,
    });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.warnings).toEqual([]);
    }
  });

  it("no warnings on default invocation", () => {
    const ctx = resolveRenderContext({ argv: [], env, isTTY: true, isStderrTTY: true });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.value.warnings).toEqual([]);
    }
  });
});
