import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectEcosystem, ECOSYSTEMS } from "../../lib/detect";
import { cleanup, createTestDir } from "../helpers";

describe("detectEcosystem", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTestDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("returns null when no lockfile is present", async () => {
    const result = await detectEcosystem(tempDir);
    expect(result).toBeNull();
  });

  it("detects bun from bun.lock", async () => {
    writeFileSync(join(tempDir, "bun.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("bun");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
    const result = await detectEcosystem(tempDir);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("pnpm");
  });

  it("detects npm from package-lock.json", async () => {
    writeFileSync(join(tempDir, "package-lock.json"), "{}");
    const result = await detectEcosystem(tempDir);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("npm");
  });

  it("detects uv from uv.lock", async () => {
    writeFileSync(join(tempDir, "uv.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("uv");
  });

  it("bun wins over npm when both lockfiles present (priority order)", async () => {
    writeFileSync(join(tempDir, "bun.lock"), "");
    writeFileSync(join(tempDir, "package-lock.json"), "{}");
    const result = await detectEcosystem(tempDir);
    expect(result?.name).toBe("bun");
  });

  it("bun setup command is array form", async () => {
    writeFileSync(join(tempDir, "bun.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result?.setup).toEqual(["bun", "install"]);
  });

  it("bun format command includes --write and {file} placeholder", async () => {
    writeFileSync(join(tempDir, "bun.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result?.format).toEqual(["bunx", "prettier", "--write", "{file}"]);
  });

  it("bun test command is array form", async () => {
    writeFileSync(join(tempDir, "bun.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result?.test).toEqual(["bun", "test"]);
  });

  it("uv format uses ruff format with {file} placeholder", async () => {
    writeFileSync(join(tempDir, "uv.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result?.format).toEqual(["uv", "run", "ruff", "format", "{file}"]);
  });

  it("uv test uses pytest", async () => {
    writeFileSync(join(tempDir, "uv.lock"), "");
    const result = await detectEcosystem(tempDir);
    expect(result?.test).toEqual(["uv", "run", "pytest"]);
  });

  it("all ecosystems have name, signal, setup, format, test fields", () => {
    for (const eco of ECOSYSTEMS) {
      expect(typeof eco.name).toBe("string");
      expect(typeof eco.signal).toBe("string");
      expect(Array.isArray(eco.setup)).toBe(true);
      expect(Array.isArray(eco.format)).toBe(true);
      expect(Array.isArray(eco.test)).toBe(true);
    }
  });
});
