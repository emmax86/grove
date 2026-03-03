import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCommandConfig, resolveCommand, spawnCommand } from "../../lib/commands";
import { cleanup, createTestDir } from "../helpers";

const GROVE_DIR = ".grove";

describe("loadCommandConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("returns null when .grove/commands.json does not exist", async () => {
    const result = await loadCommandConfig(tempDir);
    expect(result).toBeNull();
  });

  it("parses valid commands.json", async () => {
    mkdirSync(join(tempDir, GROVE_DIR));
    writeFileSync(
      join(tempDir, GROVE_DIR, "commands.json"),
      JSON.stringify({ check: ["bun", "run", "typecheck"] }),
    );
    const result = await loadCommandConfig(tempDir);
    expect(result).not.toBeNull();
    expect(result?.check).toEqual(["bun", "run", "typecheck"]);
  });

  it("returns null on invalid JSON", async () => {
    mkdirSync(join(tempDir, GROVE_DIR));
    writeFileSync(join(tempDir, GROVE_DIR, "commands.json"), "not json");
    const result = await loadCommandConfig(tempDir);
    expect(result).toBeNull();
  });

  it("falls back to .dotclaude/commands.json when .grove/commands.json does not exist", async () => {
    mkdirSync(join(tempDir, ".dotclaude"));
    writeFileSync(
      join(tempDir, ".dotclaude", "commands.json"),
      JSON.stringify({ check: ["bun", "run", "typecheck"] }),
    );
    const result = await loadCommandConfig(tempDir);
    expect(result).not.toBeNull();
    expect(result?.check).toEqual(["bun", "run", "typecheck"]);
  });

  it("emits deprecation warning when falling back to .dotclaude/commands.json", async () => {
    mkdirSync(join(tempDir, ".dotclaude"));
    writeFileSync(
      join(tempDir, ".dotclaude", "commands.json"),
      JSON.stringify({ setup: ["bun", "install"] }),
    );
    const messages: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string | Uint8Array) => {
      messages.push(String(msg));
      return true;
    };
    try {
      await loadCommandConfig(tempDir);
    } finally {
      process.stderr.write = origWrite;
    }
    expect(messages.some((m) => m.includes(".dotclaude/commands.json is deprecated"))).toBe(true);
  });

  it("emits parse warning and returns null when .dotclaude/commands.json exists but is invalid JSON", async () => {
    mkdirSync(join(tempDir, ".dotclaude"));
    writeFileSync(join(tempDir, ".dotclaude", "commands.json"), "not json");
    const messages: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string | Uint8Array) => {
      messages.push(String(msg));
      return true;
    };
    let result: unknown;
    try {
      result = await loadCommandConfig(tempDir);
    } finally {
      process.stderr.write = origWrite;
    }
    expect(result).toBeNull();
    expect(messages.some((m) => m.includes("Failed to parse") && m.includes(".dotclaude"))).toBe(
      true,
    );
  });

  it("returns null when neither .grove nor .dotclaude commands.json exists", async () => {
    const result = await loadCommandConfig(tempDir);
    expect(result).toBeNull();
  });
});

describe("resolveCommand", () => {
  it("returns null for unknown standard command with no config and no ecosystem", () => {
    const result = resolveCommand("check", null, null, {});
    expect(result).toBeNull();
  });

  it("returns ecosystem setup command when no config", () => {
    const eco = {
      name: "bun",
      signal: "bun.lock",
      setup: ["bun", "install"],
      format: ["bunx", "prettier", "--write"],
      test: ["bun", "test"],
    };
    const result = resolveCommand("setup", null, eco, {});
    expect(result).toEqual(["bun", "install"]);
  });

  it("config overrides ecosystem for array-form command", () => {
    const eco = {
      name: "bun",
      signal: "bun.lock",
      setup: ["bun", "install"],
      format: ["bunx", "prettier", "--write"],
      test: ["bun", "test"],
    };
    const config = { setup: ["bun", "install", "--frozen-lockfile"] };
    const result = resolveCommand("setup", config, eco, {});
    expect(result).toEqual(["bun", "install", "--frozen-lockfile"]);
  });

  it("returns null and does not crash when config value is wrong type (e.g. number)", () => {
    // { "setup": 42 } is structurally valid JSON but wrong type — must not throw
    const config = { setup: 42 as unknown as string[] };
    const result = resolveCommand("setup", config, null, {});
    expect(result).toBeNull();
  });

  it("config string-form wraps in sh -c", () => {
    const config = { setup: "bun install && bun run build" };
    const result = resolveCommand("setup", config, null, {});
    expect(result).toEqual(["sh", "-c", "bun install && bun run build"]);
  });

  it("substitutes {file} placeholder in array-form command", () => {
    const config = { "test:file": ["bun", "test", "{file}"] };
    const result = resolveCommand("test:file", config, null, {
      file: "/src/foo.test.ts",
    });
    expect(result).toEqual(["bun", "test", "/src/foo.test.ts"]);
  });

  it("substitutes {match} placeholder in array-form command", () => {
    const config = { "test:match": ["bun", "test", "--grep", "{match}"] };
    const result = resolveCommand("test:match", config, null, {
      match: "addWorktree",
    });
    expect(result).toEqual(["bun", "test", "--grep", "addWorktree"]);
  });

  it("does NOT perform shell interpolation — {file} with shell metacharacters becomes a literal argument", () => {
    const config = { "test:file": ["bun", "test", "{file}"] };
    // Shell injection attempt — must end up as a single literal argv element
    const result = resolveCommand("test:file", config, null, {
      file: "; rm -rf /",
    });
    expect(result).toEqual(["bun", "test", "; rm -rf /"]);
  });

  it("{file} with backticks is a single literal argument", () => {
    const config = { "test:file": ["bun", "test", "{file}"] };
    const result = resolveCommand("test:file", config, null, {
      file: "`curl evil.com`",
    });
    expect(result).toEqual(["bun", "test", "`curl evil.com`"]);
  });

  it("{file} with spaces is a single literal argument", () => {
    const config = { "test:file": ["bun", "test", "{file}"] };
    const result = resolveCommand("test:file", config, null, {
      file: "path with spaces/foo.ts",
    });
    expect(result).toEqual(["bun", "test", "path with spaces/foo.ts"]);
  });

  it("ecosystem test command used for test when no config", () => {
    const eco = {
      name: "bun",
      signal: "bun.lock",
      setup: ["bun", "install"],
      format: ["bunx", "prettier", "--write"],
      test: ["bun", "test"],
    };
    const result = resolveCommand("test", null, eco, {});
    expect(result).toEqual(["bun", "test"]);
  });

  it("ecosystem format command used when no config — {file} dropped when not provided", () => {
    const eco = {
      name: "uv",
      signal: "uv.lock",
      setup: ["uv", "sync"],
      format: ["uv", "run", "ruff", "format", "{file}"],
      test: ["uv", "run", "pytest"],
    };
    const result = resolveCommand("format", null, eco, {});
    expect(result).toEqual(["uv", "run", "ruff", "format"]);
  });

  it("ecosystem format command substitutes {file} when file provided", () => {
    const eco = {
      name: "bun",
      signal: "bun.lock",
      setup: ["bun", "install"],
      format: ["bunx", "prettier", "--write", "{file}"],
      test: ["bun", "test"],
    };
    const result = resolveCommand("format", null, eco, { file: "src/cli.ts" });
    expect(result).toEqual(["bunx", "prettier", "--write", "src/cli.ts"]);
  });

  it("{file} placeholder removed when file not provided", () => {
    const config = { format: ["prettier", "--write", "{file}"] };
    const result = resolveCommand("format", config, null, {});
    expect(result).toEqual(["prettier", "--write"]);
  });
});

describe("spawnCommand", () => {
  it("returns exit code 0 and stdout for successful command", async () => {
    const result = await spawnCommand(["echo", "hello"], process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("returns non-zero exit code for failing command", async () => {
    const result = await spawnCommand(["false"], process.cwd());
    expect(result.exitCode).not.toBe(0);
  });

  it("captures stderr separately from stdout", async () => {
    const result = await spawnCommand(["sh", "-c", "echo out; echo err >&2"], process.cwd());
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
    expect(result.exitCode).toBe(0);
  });

  it("runs command in specified working directory", async () => {
    const result = await spawnCommand(["pwd"], "/tmp");
    // On macOS /tmp resolves to /private/tmp
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
    expect(result.exitCode).toBe(0);
  });

  it("passes env vars through", async () => {
    const result = await spawnCommand(["sh", "-c", "echo $TEST_VAR"], process.cwd(), {
      env: { ...process.env, TEST_VAR: "grove" },
    });
    expect(result.stdout.trim()).toBe("grove");
  });
});
