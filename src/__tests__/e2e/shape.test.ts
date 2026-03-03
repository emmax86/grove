import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { cleanupTempRoot, createTempRoot, runCLI } from "./helpers";

describe("E2E: CLI output shape", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });
  afterEach(() => cleanupTempRoot(root));

  it("success writes JSON to stdout only, stderr is empty", async () => {
    const r = await runCLI(["ws", "add", "myws"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    expect(r.stderr).toBe("");
  });

  it("error writes JSON to stderr only, stdout is empty, exits 1", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "add", "myws"], { root }); // duplicate
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    const err = JSON.parse(r.stderr);
    expect(err.ok).toBe(false);
    expect(typeof err.error).toBe("string");
    expect(typeof err.code).toBe("string");
  });

  it("unknown top-level command exits 1", async () => {
    const r = await runCLI(["notacommand"], { root });
    expect(r.exitCode).toBe(1);
  });

  it("unknown subcommand exits 1", async () => {
    const r = await runCLI(["ws", "notasubcmd"], { root });
    expect(r.exitCode).toBe(1);
  });
});
