import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execCommand } from "../../commands/exec";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("execCommand", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeAll(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("ws", paths);
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);
  });

  afterAll(() => {
    cleanup(tempDir);
  });

  it("returns REPO_NOT_RESOLVED when neither repo nor file is specified", async () => {
    const result = await execCommand("ws", "test", {}, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_NOT_RESOLVED");
    }
  });

  it("returns WORKSPACE_NOT_FOUND for unknown workspace", async () => {
    const result = await execCommand("ghost", "setup", {}, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_NOT_FOUND");
    }
  });

  it("returns REPO_NOT_FOUND when repo specified but not registered", async () => {
    const result = await execCommand("ws", "setup", { repo: "ghost" }, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_NOT_FOUND");
    }
  });

  it("returns COMMAND_NOT_CONFIGURED when command not available", async () => {
    // No ecosystem signal file + no config — check is never auto-detected
    const result = await execCommand("ws", "check", { repo: "myrepo" }, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("COMMAND_NOT_CONFIGURED");
    }
  });

  it("dry-run returns resolved command without running it", async () => {
    // Write a bun.lock signal so ecosystem is detected
    writeFileSync(join(repoPath, "bun.lock"), "");
    const result = await execCommand("ws", "test", { repo: "myrepo", dryRun: true }, paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command).toEqual(["bun", "test"]);
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdout).toBe("");
    }
  });

  it("dry-run with file substitution resolves {file} placeholder", async () => {
    // Write a commands.json with test:file command
    mkdirSync(join(repoPath, ".grove"), { recursive: true });
    writeFileSync(
      join(repoPath, ".grove", "commands.json"),
      JSON.stringify({ "test:file": ["bun", "test", "{file}"] }),
    );
    const filePath = join(repoPath, "src", "foo.test.ts");
    const result = await execCommand(
      "ws",
      "test:file",
      { repo: "myrepo", file: filePath, dryRun: true },
      paths,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.command).toEqual(["bun", "test", filePath]);
    }
  });

  it("executes a real command and captures stdout", async () => {
    mkdirSync(join(repoPath, ".grove"), { recursive: true });
    writeFileSync(
      join(repoPath, ".grove", "commands.json"),
      JSON.stringify({ setup: ["echo", "hello-grove"] }),
    );
    const result = await execCommand("ws", "setup", { repo: "myrepo" }, paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdout.trim()).toBe("hello-grove");
      expect(result.value.repo).toBe("myrepo");
    }
  });

  it("returns ok with non-zero exitCode when command fails", async () => {
    mkdirSync(join(repoPath, ".grove"), { recursive: true });
    writeFileSync(join(repoPath, ".grove", "commands.json"), JSON.stringify({ check: ["false"] }));
    const result = await execCommand("ws", "check", { repo: "myrepo" }, paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exitCode).not.toBe(0);
    }
  });

  it("resolves relative file path to absolute before command substitution", async () => {
    mkdirSync(join(repoPath, ".grove"), { recursive: true });
    writeFileSync(
      join(repoPath, ".grove", "commands.json"),
      JSON.stringify({ "test:file": ["bun", "test", "{file}"] }),
    );
    const absoluteFile = join(repoPath, "README.md");
    const relativeFile = relative(process.cwd(), absoluteFile);
    // Ensure the path is genuinely relative (test would be vacuous otherwise)
    expect(relativeFile).not.toBe(absoluteFile);
    const result = await execCommand(
      "ws",
      "test:file",
      { repo: "myrepo", file: relativeFile, dryRun: true },
      paths,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Command must contain the resolved absolute path, not the relative one
      expect(result.value.command).toEqual(["bun", "test", resolve(relativeFile)]);
    }
  });

  it("resolves repo from file path when repo not specified", async () => {
    const filePath = join(repoPath, "README.md");
    const result = await execCommand("ws", "test", { file: filePath, dryRun: true }, paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repo).toBe("myrepo");
    }
  });
});
