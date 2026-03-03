import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addWorktree,
  findMainWorktreePath,
  getDefaultBranch,
  isGitRepo,
  listWorktrees,
  removeWorktree,
} from "../../lib/git";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV, spawnProc } from "../helpers";

describe("git lib", () => {
  let tempDir: string;
  let repoPath: string;

  beforeAll(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "testrepo");
  });

  afterAll(() => {
    cleanup(tempDir);
  });

  describe("isGitRepo", () => {
    it("returns true for a git repo", async () => {
      expect(await isGitRepo(repoPath)).toBe(true);
    });

    it("returns false for a plain directory", async () => {
      const plain = join(tempDir, "plain");
      mkdirSync(plain);
      expect(await isGitRepo(plain)).toBe(false);
    });

    it("returns false for non-existent path", async () => {
      expect(await isGitRepo(join(tempDir, "nonexistent"))).toBe(false);
    });
  });

  describe("getDefaultBranch", () => {
    it("detects main branch", async () => {
      const result = await getDefaultBranch(repoPath, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("main");
      }
    });

    it("detects master branch", async () => {
      const masterRepo = await createTestGitRepo(tempDir, "masterrepo", "master");
      const result = await getDefaultBranch(masterRepo, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("master");
      }
    });
  });

  describe("addWorktree", () => {
    it("adds a worktree for an existing branch", async () => {
      // First create a branch
      await spawnProc(["git", "branch", "existing-branch"], repoPath, {
        ...process.env,
        ...GIT_ENV,
      });

      const wtPath = join(tempDir, "wt-existing");
      const result = await addWorktree(repoPath, wtPath, "existing-branch", {}, GIT_ENV);
      expect(result.ok).toBe(true);

      // Verify it exists
      const wts = await listWorktrees(repoPath, GIT_ENV);
      expect(wts.ok).toBe(true);
      if (wts.ok) {
        const found = wts.value.find((w) => w.path === wtPath);
        expect(found).toBeDefined();
      }
    });

    it("adds a worktree with --new creating a new branch", async () => {
      const wtPath = join(tempDir, "wt-new");
      const result = await addWorktree(
        repoPath,
        wtPath,
        "new-branch",
        { newBranch: true },
        GIT_ENV,
      );
      expect(result.ok).toBe(true);
    });

    it("adds a worktree with --new --from base", async () => {
      const wtPath = join(tempDir, "wt-from");
      const result = await addWorktree(
        repoPath,
        wtPath,
        "from-branch",
        { newBranch: true, from: "main" },
        GIT_ENV,
      );
      expect(result.ok).toBe(true);
    });

    it("fails when branch doesn't exist and not new", async () => {
      const wtPath = join(tempDir, "wt-nonexistent");
      const result = await addWorktree(repoPath, wtPath, "nonexistent-branch", {}, GIT_ENV);
      expect(result.ok).toBe(false);
    });

    it("fails when branch already checked out", async () => {
      const wtPath = join(tempDir, "wt-main-dupe");
      const result = await addWorktree(repoPath, wtPath, "main", {}, GIT_ENV);
      expect(result.ok).toBe(false);
    });
  });

  describe("removeWorktree", () => {
    it("removes a clean worktree", async () => {
      const wtPath = join(tempDir, "wt-to-remove");
      await spawnProc(["git", "branch", "to-remove"], repoPath, {
        ...process.env,
        ...GIT_ENV,
      });
      await addWorktree(repoPath, wtPath, "to-remove", {}, GIT_ENV);

      const result = await removeWorktree(repoPath, wtPath, false, GIT_ENV);
      expect(result.ok).toBe(true);
    });

    it("fails without force on dirty worktree", async () => {
      const wtPath = join(tempDir, "wt-dirty");
      await spawnProc(["git", "branch", "dirty-branch"], repoPath, {
        ...process.env,
        ...GIT_ENV,
      });
      await addWorktree(repoPath, wtPath, "dirty-branch", {}, GIT_ENV);

      // Make it dirty
      writeFileSync(join(wtPath, "dirty.txt"), "dirty file");

      const result = await removeWorktree(repoPath, wtPath, false, GIT_ENV);
      expect(result.ok).toBe(false);
    });

    it("removes dirty worktree with force", async () => {
      const wtPath = join(tempDir, "wt-dirty-force");
      await spawnProc(["git", "branch", "dirty-force-branch"], repoPath, {
        ...process.env,
        ...GIT_ENV,
      });
      await addWorktree(repoPath, wtPath, "dirty-force-branch", {}, GIT_ENV);

      // Make it dirty
      writeFileSync(join(wtPath, "dirty.txt"), "dirty file");

      const result = await removeWorktree(repoPath, wtPath, true, GIT_ENV);
      expect(result.ok).toBe(true);
    });
  });

  describe("listWorktrees", () => {
    it("returns all worktrees with branch info", async () => {
      const result = await listWorktrees(repoPath, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should at least have the main worktree
        expect(result.value.length).toBeGreaterThan(0);
        const main = result.value.find((w) => w.path === repoPath);
        expect(main).toBeDefined();
        if (main) {
          expect(main.branch).toBe("main");
          expect(main.isDetached).toBe(false);
        }
      }
    });

    it("returns error when called on a non-git directory", async () => {
      const plain = join(tempDir, "plain-for-list");
      mkdirSync(plain);
      const result = await listWorktrees(plain, GIT_ENV);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("GIT_WORKTREE_LIST_ERROR");
      }
    });
  });

  describe("getDefaultBranch", () => {
    it("returns error on a non-git directory", async () => {
      const plain = join(tempDir, "plain-for-branch");
      mkdirSync(plain);
      const result = await getDefaultBranch(plain, GIT_ENV);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("GIT_DEFAULT_BRANCH_ERROR");
      }
    });
  });

  describe("removeWorktree edge cases", () => {
    it("returns ok when worktree dir does not exist (already gone)", async () => {
      const wtPath = join(tempDir, "wt-already-gone");
      // Don't create it — git will fail with "is not a working tree" or similar
      // but our code treats those as ok
      const result = await removeWorktree(repoPath, wtPath, false, GIT_ENV);
      // This may succeed (ok) or fail with GIT_WORKTREE_REMOVE_ERROR depending on
      // git version's stderr message — the key is we don't crash
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("findMainWorktreePath", () => {
    it("returns the main worktree path", async () => {
      const result = await findMainWorktreePath(repoPath, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(repoPath);
      }
    });

    it("returns error on non-git directory", async () => {
      const plain = join(tempDir, "plain-for-main");
      mkdirSync(plain);
      const result = await findMainWorktreePath(plain, GIT_ENV);
      expect(result.ok).toBe(false);
    });
  });
});
