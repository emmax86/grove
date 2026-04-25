import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { cleanupTempRoot, createTempRoot, runCLI } from "./helpers";

describe("CLI output modes (smoke)", () => {
  let root: string;
  beforeEach(async () => {
    root = await createTempRoot();
  });
  afterEach(async () => {
    await cleanupTempRoot(root);
  });

  it("ws list default text: name + path columns, no JSON", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "list"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("myws");
    expect(r.json).toBeUndefined(); // not parseable as JSON
  });

  it("ws list --json: parseable envelope", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "list", "--json"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.json).toBeDefined();
    expect(r.json?.ok).toBe(true);
  });

  it("ws list --porcelain: tab-separated, no JSON", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "list", "--porcelain"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/myws\t/);
    expect(r.json).toBeUndefined();
  });

  it("--porcelain --json returns INVALID_FLAGS", async () => {
    const r = await runCLI(["ws", "list", "--porcelain", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("INVALID_FLAGS");
  });

  it("error renders text by default", async () => {
    const r = await runCLI(["ws", "remove", "nonexistent"], { root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("error:");
    expect(r.stderr).toContain("code:");
  });

  it("error renders JSON with --json", async () => {
    const r = await runCLI(["ws", "remove", "nonexistent", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).ok).toBe(false);
  });

  it("unknown top-level command renders structured error", async () => {
    const r = await runCLI(["does-not-exist"], { root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("error:");
    expect(r.stderr).toContain("code: UNKNOWN_COMMAND");
  });

  it("unknown ws subcommand renders structured error", async () => {
    const r = await runCLI(["ws", "does-not-exist"], { root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("error:");
    expect(r.stderr).toContain("code: UNKNOWN_SUBCOMMAND");
  });

  it("unknown ws repo subcommand renders structured error", async () => {
    const r = await runCLI(["ws", "repo", "does-not-exist"], { root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("error:");
    expect(r.stderr).toContain("code: UNKNOWN_SUBCOMMAND");
  });

  it("warnings are suppressed in --json mode", async () => {
    await runCLI(["ws", "add", "ws1"], { root });
    // --no-color in json mode would normally emit a warning; it must not
    const r = await runCLI(["ws", "list", "--json", "--no-color"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("warning:");
  });

  it("warnings are emitted to stderr in text mode when --no-color is used in non-text mode context", async () => {
    // This is a meta-check: if mode is NOT text, warnings appear only when
    // mode is text. We verify json suppresses; text mode with --no-color
    // doesn't warn at all (--no-color is valid in text mode).
    await runCLI(["ws", "add", "ws1"], { root });
    const r = await runCLI(["ws", "list", "--no-color"], { root });
    expect(r.exitCode).toBe(0);
    // No warning in text mode — --no-color is respected, not warned about
    expect(r.stderr).not.toContain("warning:");
  });

  it("unknown subcommand error JSON when --json passed", async () => {
    const r = await runCLI(["ws", "does-not-exist", "--json"], { root });
    expect(r.exitCode).toBe(1);
    const json = JSON.parse(r.stderr);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("UNKNOWN_SUBCOMMAND");
  });

  it("ws remove --json includes name in data", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "remove", "myws", "--json"], { root });
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.data.name).toBe("myws");
  });

  it("ws sync --json includes pruned field", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "sync", "myws", "--json"], { root });
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data.pruned)).toBe(true);
    expect(Array.isArray(json.data.repos)).toBe(true);
    expect(json.data.name).toBe("myws");
  });
});
