import { describe, expect, it } from "bun:test";

import packageJson from "../../../package.json";
import { runCLI } from "./helpers";

const VERSION = packageJson.version;

describe("grove --version", () => {
  it("prints 'grove version <v>' in text mode with --version", async () => {
    const r = await runCLI(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`grove version ${VERSION}`);
    expect(r.stderr).toBe("");
  });

  it("prints 'grove version <v>' in text mode with -V", async () => {
    const r = await runCLI(["-V"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`grove version ${VERSION}`);
    expect(r.stderr).toBe("");
  });

  it("returns JSON envelope with --version --json", async () => {
    const r = await runCLI(["--version", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.json).toBeDefined();
    expect(r.json?.ok).toBe(true);
    expect((r.json as { data: { version: string } }).data.version).toBe(VERSION);
  });

  it("prints bare version with --version --porcelain", async () => {
    const r = await runCLI(["--version", "--porcelain"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(VERSION);
    expect(r.stderr).toBe("");
  });

  it("appears in `grove --help` global flags listing", async () => {
    const r = await runCLI(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--version");
  });
});
