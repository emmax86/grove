import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { addRepo } from "../../commands/repo";
import { getStatus } from "../../commands/status";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("status command", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
  });

  afterEach(() => cleanup(tempDir));

  it("shows workspace name", async () => {
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("myws");
    }
  });

  it("shows repo count > 0", async () => {
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repos.length).toBeGreaterThan(0);
    }
  });

  it("shows worktree list per repo", async () => {
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const repo = result.value.repos.find((r) => r.name === "myrepo");
      expect(repo).toBeDefined();
      if (repo) {
        expect(repo.worktrees.length).toBeGreaterThan(0);
        const slugs = repo.worktrees.map((w) => w.slug);
        expect(slugs).toContain("feature-x");
      }
    }
  });

  it("flags dangling symlinks", async () => {
    // Remove repo to make dangling
    await rm(repoPath, { recursive: true, force: true });
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const repo = result.value.repos.find((r) => r.name === "myrepo");
      expect(repo?.status).toBe("dangling");
    }
  });

  it("returns WORKSPACE_NOT_FOUND for non-existent workspace", async () => {
    const result = await getStatus("ghost", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_NOT_FOUND");
    }
  });

  it("returns CONFIG_INVALID for corrupted workspace config", async () => {
    await writeFile(paths.workspaceConfig("myws"), "not-json");
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_INVALID");
    }
  });
});
