import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { exists, lstat, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";

import { addRepo, listRepos } from "../../commands/repo";
import { getStatus } from "../../commands/status";
import { addWorkspace, listWorkspaces } from "../../commands/workspace";
import { addWorktree, listWorktrees, removeWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, entryGone, GIT_ENV } from "../helpers";

describe("lifecycle integration", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeAll(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterAll(() => cleanup(tempDir));

  it("creates a workspace", async () => {
    const result = await addWorkspace("myws", paths);
    expect(result.ok).toBe(true);

    const list = await listWorkspaces(paths);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.map((w) => w.name)).toContain("myws");
    }
  });

  it("adds a repo to the workspace", async () => {
    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const list = await listRepos("myws", paths);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.map((r) => r.name)).toContain("myrepo");
    }

    // repo symlink exists
    expect(await exists(paths.repoEntry("myrepo"))).toBe(true);

    // default branch symlink exists in workspace
    const defaultBranchPath = join(paths.repoDir("myws", "myrepo"), "main");
    const stat = await lstat(defaultBranchPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // full chain: {workspace}/trees/myrepo/main -> ../../../repos/myrepo -> actual path
    expect(await realpath(defaultBranchPath)).toBe(await realpath(repoPath));
  });

  it("adds a worktree", async () => {
    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature/test",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe("feature-test");
      expect(result.value.type).toBe("worktree");
    }
  });

  it("lists worktrees including new worktree", async () => {
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const slugs = result.value.map((w) => w.slug);
      expect(slugs).toContain("feature-test");
      expect(slugs).toContain("main"); // default branch linked entry
    }
  });

  it("worktree pool entry is a real directory, workspace entry is a symlink", async () => {
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-test");
    const wsEntry = paths.worktreeDir("myws", "myrepo", "feature-test");

    expect(await exists(poolEntry)).toBe(true);
    expect((await lstat(poolEntry)).isDirectory()).toBe(true);
    expect((await lstat(poolEntry)).isSymbolicLink()).toBe(false);

    expect((await lstat(wsEntry)).isSymbolicLink()).toBe(true);
    // Symlink points into the pool
    const target = await readlink(wsEntry);
    expect(target).toContain("worktrees");
  });

  it("gets workspace status", async () => {
    const result = await getStatus("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("myws");
      expect(result.value.repos.length).toBeGreaterThan(0);
      const repo = result.value.repos.find((r) => r.name === "myrepo");
      expect(repo).toBeDefined();
      if (repo) {
        expect(repo.worktrees.map((w) => w.slug)).toContain("feature-test");
      }
    }
  });

  it("removes a worktree", async () => {
    const result = await removeWorktree("myws", "myrepo", "feature-test", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // Workspace symlink removed — lstat throws ENOENT when the symlink file itself is gone
    const wsEntry = paths.worktreeDir("myws", "myrepo", "feature-test");
    expect(await entryGone(wsEntry)).toBe(true);

    // Pool entry removed (last reference)
    expect(await exists(paths.worktreePoolEntry("myrepo", "feature-test"))).toBe(false);
  });

  it("worktree no longer in list after removal", async () => {
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((w) => w.slug)).not.toContain("feature-test");
    }
  });
});
