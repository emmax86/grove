import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import {
  classifyWorktreeEntry,
  removePoolWorktree,
  resolveRepoPath,
} from "../../lib/worktree-utils";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("classifyWorktreeEntry", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let repoPath: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("returns 'pool' for pool symlink", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");
    expect(await classifyWorktreeEntry(wtPath, paths)).toBe("pool");
  });

  it("returns 'linked' for default-branch symlink", async () => {
    // addRepo already created the default branch symlink
    const wtPath = paths.worktreeDir("myws", "myrepo", "main");
    expect(await classifyWorktreeEntry(wtPath, paths)).toBe("linked");
  });

  it("returns 'legacy' for real directory", async () => {
    const dir = join(tempDir, "realdir");
    mkdirSync(dir);
    expect(await classifyWorktreeEntry(dir, paths)).toBe("legacy");
  });

  it("returns null for non-existent path", async () => {
    expect(await classifyWorktreeEntry(join(tempDir, "nonexistent"), paths)).toBe(null);
  });

  it("returns null for regular file", async () => {
    const file = join(tempDir, "file.txt");
    writeFileSync(file, "hello");
    expect(await classifyWorktreeEntry(file, paths)).toBe(null);
  });

  it("returns 'linked' for unknown symlink target (safe fallback)", async () => {
    const wtPath = paths.worktreeDir("myws", "myrepo", "unknown-slug");
    mkdirSync(dirname(wtPath), { recursive: true });
    symlinkSync("/some/absolute/path", wtPath);
    expect(await classifyWorktreeEntry(wtPath, paths)).toBe("linked");
  });

  it("returns 'pool' for dangling pool symlink", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");
    // Delete the pool entry to make the workspace symlink dangle
    rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
      recursive: true,
      force: true,
    });
    // classifyWorktreeEntry uses lstat (inspects symlink itself, not target)
    // and readlink (reads raw target string), so it still classifies as "pool"
    expect(await classifyWorktreeEntry(wtPath, paths)).toBe("pool");
  });
});

describe("resolveRepoPath", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let repoPath: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("resolves a valid repo symlink to its real path", async () => {
    const result = await resolveRepoPath("myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(repoPath);
    }
  });

  it("returns DANGLING_SYMLINK error when repo dir is removed", async () => {
    rmSync(repoPath, { recursive: true, force: true });
    const result = await resolveRepoPath("myrepo", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DANGLING_SYMLINK");
    }
  });

  it("returns DANGLING_SYMLINK error for missing entry", async () => {
    const result = await resolveRepoPath("nonexistent", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DANGLING_SYMLINK");
    }
  });
});

describe("removePoolWorktree", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("does remove tree symlink, pool dir, and worktrees.json when last reference", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-x");

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    let symlinkGone = false;
    try {
      lstatSync(wtPath);
    } catch {
      symlinkGone = true;
    }
    expect(symlinkGone).toBe(true);
    expect(existsSync(poolEntry)).toBe(false);
    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
  });

  it("does update worktrees.json when pool directory is already gone", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
      recursive: true,
      force: true,
    });

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
  });

  it("does skip git call when pool directory does not exist", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
      recursive: true,
      force: true,
    });

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gitWarning).toBeUndefined();
    }
  });

  it("does remove tree symlink even when git worktree remove fails", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    writeFileSync(join(paths.worktreePoolEntry("myrepo", "feature-x"), "dirty.txt"), "dirty");
    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    let symlinkGone = false;
    try {
      lstatSync(wtPath);
    } catch {
      symlinkGone = true;
    }
    expect(symlinkGone).toBe(true);
  });

  it("does update worktrees.json even when git worktree remove fails", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    writeFileSync(join(paths.worktreePoolEntry("myrepo", "feature-x"), "dirty.txt"), "dirty");

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
  });

  it("does return gitWarning when git worktree remove fails", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    writeFileSync(join(paths.worktreePoolEntry("myrepo", "feature-x"), "dirty.txt"), "dirty");

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gitWarning).toBeDefined();
    }
  });

  it("does keep pool dir when other workspaces still reference it", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-shared");

    const result = await removePoolWorktree("myws", "myrepo", "feature-shared", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    expect(existsSync(poolEntry)).toBe(true);
  });

  it("does remove only this workspace from worktrees.json when other refs remain", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);

    const result = await removePoolWorktree("myws", "myrepo", "feature-shared", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo["feature-shared"]).not.toContain("myws");
    expect(pool.myrepo["feature-shared"]).toContain("otherws");
  });

  it("does skip symlink removal when skipSymlink is true", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");

    const result = await removePoolWorktree(
      "myws",
      "myrepo",
      "feature-x",
      { skipSymlink: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);

    expect(lstatSync(wtPath).isSymbolicLink()).toBe(true);
    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
    expect(existsSync(paths.worktreePoolEntry("myrepo", "feature-x"))).toBe(false);
  });

  it("does succeed when worktrees.json does not exist", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    rmSync(paths.worktreePoolConfig, { force: true });

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
  });

  it("does not remove pool dir when workspace is not listed for the slug", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-x");

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    expect(existsSync(poolEntry)).toBe(true);
  });

  it("does not remove pool dir when worktrees.json entry is missing", async () => {
    // Shared pool worktree owned by otherws; worktrees.json entry is absent for myws.
    // removePoolWorktree("myws",...) should NOT delete the pool dir — we have no evidence
    // it is the last reference when the metadata is missing.
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-x");

    // Delete worktrees.json so the entry for otherws is lost
    rmSync(paths.worktreePoolConfig, { force: true });

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    // Pool dir must survive — we can't verify no other workspace references it
    expect(existsSync(poolEntry)).toBe(true);
  });
});

describe("removePoolWorktree (dangling repo)", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("does succeed and clean worktrees.json when repo symlink is dangling", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    // Remove actual repo to make repo symlink dangle
    rmSync(repoPath, { recursive: true, force: true });

    const result = await removePoolWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
  });
});
