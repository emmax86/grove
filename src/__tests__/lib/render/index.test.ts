import { describe, expect, it } from "bun:test";

import { render } from "../../../lib/render";
import { err, ok } from "../../../types";

describe("render — JSON envelope", () => {
  const ctx = {
    mode: "json" as const,
    colorEnabled: false,
    unicodeEnabled: true,
    isTTY: false,
    isStderrTTY: false,
    warnings: [],
  };

  it("flat single-line JSON when not TTY", () => {
    const out = render(ok({ name: "foo" }), "workspace-add", ctx);
    expect(out.stdout).toBe('{"ok":true,"data":{"name":"foo"}}');
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  it("pretty-prints when TTY", () => {
    const out = render(ok({ name: "foo" }), "workspace-add", { ...ctx, isTTY: true });
    expect(out.stdout).toContain("\n");
    expect(JSON.parse(out.stdout)).toEqual({ ok: true, data: { name: "foo" } });
  });

  it("emits error JSON to stderr with exit 1", () => {
    const out = render(err("nope", "WORKSPACE_NOT_FOUND"), "workspace-add", ctx);
    expect(out.stdout).toBe("");
    expect(JSON.parse(out.stderr)).toEqual({
      ok: false,
      error: "nope",
      code: "WORKSPACE_NOT_FOUND",
    });
    expect(out.exitCode).toBe(1);
  });
});

describe("render — error in text/porcelain modes", () => {
  it("renders text error to stderr in text mode", () => {
    const ctx = {
      mode: "text" as const,
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: false,
      isStderrTTY: false,
      warnings: [],
    };
    const out = render(err("nope", "WORKSPACE_NOT_FOUND"), "workspace-add", ctx);
    expect(out.stderr).toBe("error: nope\n  code: WORKSPACE_NOT_FOUND");
    expect(out.stdout).toBe("");
    expect(out.exitCode).toBe(1);
  });

  it("renders the same text error in porcelain mode", () => {
    const ctx = {
      mode: "porcelain" as const,
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: false,
      isStderrTTY: false,
      warnings: [],
    };
    const out = render(err("nope", "WORKSPACE_NOT_FOUND"), "workspace-add", ctx);
    expect(out.stderr).toBe("error: nope\n  code: WORKSPACE_NOT_FOUND");
    expect(out.exitCode).toBe(1);
  });
});

describe("render — JSON error envelope TTY pretty-print", () => {
  it("error JSON pretty-prints when stderr is TTY", () => {
    const out = render(err("nope", "WORKSPACE_NOT_FOUND"), "workspace-add", {
      mode: "json",
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: false,
      isStderrTTY: true,
      warnings: [],
    });
    expect(out.stderr).toContain("\n");
    expect(JSON.parse(out.stderr)).toEqual({
      ok: false,
      error: "nope",
      code: "WORKSPACE_NOT_FOUND",
    });
  });

  it("error JSON is compact when stderr is not TTY", () => {
    const out = render(err("nope", "WORKSPACE_NOT_FOUND"), "workspace-add", {
      mode: "json",
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: true,
      isStderrTTY: false,
      warnings: [],
    });
    expect(out.stderr).not.toContain("\n");
    expect(JSON.parse(out.stderr)).toEqual({
      ok: false,
      error: "nope",
      code: "WORKSPACE_NOT_FOUND",
    });
  });

  it("success JSON pretty-prints when stdout is TTY", () => {
    const out = render(ok({ name: "foo" }), "workspace-add", {
      mode: "json",
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: true,
      isStderrTTY: false,
      warnings: [],
    });
    expect(out.stdout).toContain("\n");
    expect(JSON.parse(out.stdout)).toEqual({ ok: true, data: { name: "foo" } });
  });

  it("success JSON is compact when stdout is not TTY", () => {
    const out = render(ok({ name: "foo" }), "workspace-add", {
      mode: "json",
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: false,
      isStderrTTY: true,
      warnings: [],
    });
    expect(out.stdout).not.toContain("\n");
    expect(JSON.parse(out.stdout)).toEqual({ ok: true, data: { name: "foo" } });
  });
});

describe("render — unknown command kind", () => {
  it("throws on unknown kind to force exhaustiveness", () => {
    const ctx = {
      mode: "text" as const,
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: false,
      isStderrTTY: false,
      warnings: [],
    };
    // biome-ignore lint/suspicious/noExplicitAny: testing exhaustiveness escape hatch
    expect(() => render(ok({}), "unknown-kind" as any, ctx)).toThrow();
  });
});
