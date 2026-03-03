import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import {
  addWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
} from "../../commands/worktree";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV, spawnProc } from "../helpers";

describe("worktree commands", () => {
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

  it("add creates pool entry and workspace symlink", async () => {
    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature/x",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);

    const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");

    // Workspace entry is a symlink
    const lstat = lstatSync(wtPath);
    expect(lstat.isSymbolicLink()).toBe(true);

    // Symlink target points to pool
    const target = readlinkSync(wtPath);
    expect(target).toBe("../../../worktrees/myrepo/feature-x");

    // Pool entry is a real directory
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-x");
    expect(existsSync(poolEntry)).toBe(true);
    expect(lstatSync(poolEntry).isDirectory()).toBe(true);
    expect(lstatSync(poolEntry).isSymbolicLink()).toBe(false);
  });

  it("add then list includes worktree", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((w) => w.slug)).toContain("feature-x");
    }
  });

  it("list classifies pool symlinks as worktree type", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.value.find((w) => w.slug === "feature-x");
      expect(entry?.type).toBe("worktree");
    }
  });

  it("list classifies default-branch symlinks as linked type", async () => {
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const linked = result.value.find((w) => w.type === "linked");
      expect(linked).toBeDefined();
    }
  });

  it("add with --new creates new branch", async () => {
    const result = await addWorktree(
      "myws",
      "myrepo",
      "brand-new-branch",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe("brand-new-branch");
      expect(result.value.type).toBe("worktree");
    }
  });

  it("add with --from branches off specified base", async () => {
    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature/from-main",
      { newBranch: true, from: "main" },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);
  });

  it("add fails if repo not registered in workspace", async () => {
    const result = await addWorktree("myws", "unknown-repo", "branch", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_NOT_FOUND");
    }
  });

  it("add detects slug collision (target dir already exists)", async () => {
    await addWorktree("myws", "myrepo", "feature/auth", { newBranch: true }, paths, GIT_ENV);
    // feature-auth slug already exists
    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature-auth",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SLUG_COLLISION");
    }
  });

  it("add to second workspace reuses pool entry", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);

    await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
    const result = await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // Both workspace entries are symlinks pointing to same pool
    const ws1Link = readlinkSync(paths.worktreeDir("myws", "myrepo", "feature-shared"));
    const ws2Link = readlinkSync(paths.worktreeDir("otherws", "myrepo", "feature-shared"));
    expect(ws1Link).toBe("../../../worktrees/myrepo/feature-shared");
    expect(ws2Link).toBe("../../../worktrees/myrepo/feature-shared");

    // worktrees.json lists both workspaces
    const poolRaw = readFileSync(paths.worktreePoolConfig, "utf-8");
    const pool = JSON.parse(poolRaw);
    expect(pool.myrepo["feature-shared"]).toContain("myws");
    expect(pool.myrepo["feature-shared"]).toContain("otherws");
  });

  it("remove then list excludes worktree", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
    const result = await removeWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const list = await listWorktrees("myws", "myrepo", paths);
    if (list.ok) {
      expect(list.value.map((w) => w.slug)).not.toContain("feature-x");
    }
  });

  it("remove refuses dirty worktree without --force", async () => {
    await addWorktree("myws", "myrepo", "feature/dirty", { newBranch: true }, paths, GIT_ENV);
    const poolEntryPath = paths.worktreePoolEntry("myrepo", "feature-dirty");
    writeFileSync(join(poolEntryPath, "dirty.txt"), "dirty");

    const result = await removeWorktree("myws", "myrepo", "feature-dirty", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
  });

  it("remove --force removes dirty worktree", async () => {
    await addWorktree("myws", "myrepo", "feature/dirty2", { newBranch: true }, paths, GIT_ENV);
    const poolEntryPath = paths.worktreePoolEntry("myrepo", "feature-dirty2");
    writeFileSync(join(poolEntryPath, "dirty.txt"), "dirty");

    const result = await removeWorktree(
      "myws",
      "myrepo",
      "feature-dirty2",
      { force: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(true);
  });

  it("remove refuses to remove default branch symlink", async () => {
    const result = await removeWorktree("myws", "myrepo", "main", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CANNOT_REMOVE_DEFAULT_BRANCH");
    }
  });

  it("remove refuses default branch symlink even when dangling", async () => {
    // Make default branch symlink dangle by removing the global repo entry
    rmSync(paths.repoEntry("myrepo"));
    const result = await removeWorktree("myws", "myrepo", "main", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CANNOT_REMOVE_DEFAULT_BRANCH");
    }
  });

  it("list includes dangling default branch symlink as linked type", async () => {
    // Make default branch symlink dangle by removing the global repo entry
    try {
      rmSync(paths.repoEntry("myrepo"));
    } catch {
      /* already gone from previous test */
    }

    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const main = result.value.find((w) => w.slug === "main");
      expect(main?.type).toBe("linked");
    }
  });

  it("worktrees.json updated on add and remove", async () => {
    await addWorktree("myws", "myrepo", "feature/tracked", { newBranch: true }, paths, GIT_ENV);

    // After add
    const afterAdd = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(afterAdd.myrepo["feature-tracked"]).toContain("myws");

    await removeWorktree("myws", "myrepo", "feature-tracked", {}, paths, GIT_ENV);

    // After remove — entry should be gone
    const afterRemove = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(afterRemove.myrepo).toBeUndefined();
  });

  it("cross-workspace lifecycle: shared pool entry", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);

    // Add same branch to both workspaces
    await addWorktree("myws", "myrepo", "feature/cross", { newBranch: true }, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/cross", {}, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-cross");

    // Remove from ws1
    const r1 = await removeWorktree("myws", "myrepo", "feature-cross", {}, paths, GIT_ENV);
    expect(r1.ok).toBe(true);

    // ws1 symlink is gone
    let ws1Gone = false;
    try {
      lstatSync(paths.worktreeDir("myws", "myrepo", "feature-cross"));
    } catch {
      ws1Gone = true;
    }
    expect(ws1Gone).toBe(true);

    // Pool entry persists
    expect(existsSync(poolEntry)).toBe(true);

    // ws2 symlink intact
    expect(
      lstatSync(paths.worktreeDir("otherws", "myrepo", "feature-cross")).isSymbolicLink(),
    ).toBe(true);

    // worktrees.json has only otherws
    const pool1 = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool1.myrepo["feature-cross"]).toEqual(["otherws"]);

    // Remove from ws2
    const r2 = await removeWorktree("otherws", "myrepo", "feature-cross", {}, paths, GIT_ENV);
    expect(r2.ok).toBe(true);

    // Pool entry is gone
    expect(existsSync(poolEntry)).toBe(false);

    // worktrees.json empty for myrepo
    const pool2 = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool2.myrepo).toBeUndefined();
  });

  it("addWorktree rollback: removes symlink and pool entry when addPoolReference fails", async () => {
    // Write an array to worktrees.json so readPoolConfig returns POOL_CONFIG_INVALID
    writeFileSync(paths.worktreePoolConfig, JSON.stringify([1, 2, 3]));

    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature/pool-fail",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POOL_CONFIG_INVALID");
    }

    // Workspace symlink should have been rolled back
    let symlinkGone = false;
    try {
      lstatSync(paths.worktreeDir("myws", "myrepo", "feature-pool-fail"));
    } catch {
      symlinkGone = true;
    }
    expect(symlinkGone).toBe(true);

    // Pool entry should have been rolled back
    expect(existsSync(paths.worktreePoolEntry("myrepo", "feature-pool-fail"))).toBe(false);
  });

  it("addWorktree rollback: removes pool entry when symlink creation fails", async () => {
    // Make the repo dir read-only so symlink fails
    const repoDir = paths.repoDir("myws", "myrepo");
    chmodSync(repoDir, 0o444);

    const result = await addWorktree(
      "myws",
      "myrepo",
      "feature/ro",
      { newBranch: true },
      paths,
      GIT_ENV,
    );
    chmodSync(repoDir, 0o755); // restore

    expect(result.ok).toBe(false);
    // Pool entry should have been rolled back
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-ro");
    expect(existsSync(poolEntry)).toBe(false);
  });

  it("addWorktree fails when git worktree add fails", async () => {
    // Use a non-existent branch without --new
    const result = await addWorktree(
      "myws",
      "myrepo",
      "definitely-nonexistent",
      {},
      paths,
      GIT_ENV,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GIT_WORKTREE_ADD_ERROR");
    }
  });

  it("remove returns WORKTREE_NOT_FOUND for unknown slug", async () => {
    const result = await removeWorktree("myws", "myrepo", "no-such-slug", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKTREE_NOT_FOUND");
    }
  });

  it("does clean worktrees.json when removeWorktree called after symlink externally deleted", async () => {
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    // Externally delete the workspace symlink (simulates manual deletion)
    rmSync(paths.worktreeDir("myws", "myrepo", "feature-x"), { force: true });

    // classifyWorktreeEntry returns null for the missing symlink — should fall back to json lookup
    const result = await removeWorktree("myws", "myrepo", "feature-x", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // worktrees.json should be cleaned up
    const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(pool.myrepo).toBeUndefined();
  });

  describe("pruneWorktrees", () => {
    it("returns empty pruned list when no dangling entries", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }
    });

    it("does remove dangling pool symlink when target directory is missing", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
      const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");
      // Delete pool entry to make the workspace symlink dangle
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].repo).toBe("myrepo");
        expect(result.value.pruned[0].slug).toBe("feature-x");
      }

      // Symlink was removed — lstatSync should throw
      let symlinkGone = false;
      try {
        lstatSync(wtPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);

      // worktrees.json cleaned up
      const pool = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
      expect(pool.myrepo).toBeUndefined();
    });

    it("does not prune valid pool symlinks", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
      await addWorktree("myws", "myrepo", "feature/y", { newBranch: true }, paths, GIT_ENV);
      // Delete only feature-x pool entry
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].slug).toBe("feature-x");
      }

      // feature-y symlink still exists
      expect(lstatSync(paths.worktreeDir("myws", "myrepo", "feature-y")).isSymbolicLink()).toBe(
        true,
      );
    });

    it("does not prune linked (default-branch) symlinks", async () => {
      // Dangle the repos/ entry so the linked symlink (main) becomes dangling too
      rmSync(paths.repoEntry("myrepo"), { force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }

      // The linked symlink file itself is still present
      expect(lstatSync(paths.worktreeDir("myws", "myrepo", "main")).isSymbolicLink()).toBe(true);
    });

    it("does prune default-branch linked symlink when HEAD is on a non-default branch and symlink is dangling (known HEAD limitation)", async () => {
      // Known limitation: getDefaultBranch reads HEAD from repo.path, not a stored canonical
      // default. If the user has checked out a non-default branch on their main worktree,
      // defaultSlug will be wrong. In the double-fault case where repos/ is also dangling,
      // the old default-branch symlink (main) will be incorrectly pruned.
      // ws sync repairs the symlink afterward using the new HEAD value.
      await spawnProc(["git", "checkout", "-b", "feature-branch"], repoPath, {
        ...process.env,
        ...GIT_ENV,
      });
      rmSync(paths.repoEntry("myrepo"), { force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const slugs = result.value.pruned.map((e) => e.slug);
        expect(slugs).toContain("main");
      }
    });

    it("does not prune legacy directories", async () => {
      const legacyDir = paths.worktreeDir("myws", "myrepo", "legacy-slug");
      mkdirSync(legacyDir, { recursive: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }

      // Directory still exists
      expect(lstatSync(legacyDir).isDirectory()).toBe(true);
    });

    it("does prune dangling symlinks across multiple repos when targets are missing", async () => {
      const repo2Path = await createTestGitRepo(tempDir, "myrepo2");
      await addRepo("myws", repo2Path, undefined, paths, GIT_ENV);
      await addWorktree("myws", "myrepo", "feature/a", { newBranch: true }, paths, GIT_ENV);
      await addWorktree("myws", "myrepo2", "feature/a", { newBranch: true }, paths, GIT_ENV);

      rmSync(paths.worktreePoolEntry("myrepo", "feature-a"), {
        recursive: true,
        force: true,
      });
      rmSync(paths.worktreePoolEntry("myrepo2", "feature-a"), {
        recursive: true,
        force: true,
      });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(2);
        const repos = result.value.pruned.map((e) => e.repo);
        expect(repos).toContain("myrepo");
        expect(repos).toContain("myrepo2");
        for (const entry of result.value.pruned) {
          expect(entry.slug).toBe("feature-a");
        }
      }
    });

    it("does remove only this workspace's symlink when pool entry is dangling", async () => {
      await addWorkspace("otherws", paths);
      await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
      await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
      await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);

      // Delete pool entry — both workspace symlinks dangle
      rmSync(paths.worktreePoolEntry("myrepo", "feature-shared"), {
        recursive: true,
        force: true,
      });

      // Prune only ws A (myws)
      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].repo).toBe("myrepo");
        expect(result.value.pruned[0].slug).toBe("feature-shared");
      }

      // ws B's symlink is untouched — lstatSync should succeed
      expect(
        lstatSync(paths.worktreeDir("otherws", "myrepo", "feature-shared")).isSymbolicLink(),
      ).toBe(true);
    });

    it("does return empty pruned list when called again after previous prune", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });

      await pruneWorktrees("myws", paths, GIT_ENV); // first pass removes symlink

      const second = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.pruned).toEqual([]);
      }
    });

    it("returns WORKSPACE_NOT_FOUND for non-existent workspace", async () => {
      const result = await pruneWorktrees("ghost", paths, GIT_ENV);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("WORKSPACE_NOT_FOUND");
      }
    });

    it("does remove dangling pool symlink when repo symlink is also dangling", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);
      const wtPath = paths.worktreeDir("myws", "myrepo", "feature-x");

      // Delete pool entry AND repos/ symlink
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });
      rmSync(paths.repoEntry("myrepo"), { force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].slug).toBe("feature-x");
      }

      // Symlink was removed
      let symlinkGone = false;
      try {
        lstatSync(wtPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);
    });

    it("does remove dangling symlink when worktrees.json does not exist", async () => {
      // Create pool dir and workspace symlink manually (no worktrees.json involved)
      const slug = "manual";
      const poolEntry = paths.worktreePoolEntry("myrepo", slug);
      mkdirSync(poolEntry, { recursive: true });
      const wtPath = paths.worktreeDir("myws", "myrepo", slug);
      symlinkSync(relative(dirname(wtPath), poolEntry), wtPath);

      // Delete pool entry to make symlink dangle, and ensure no worktrees.json
      rmSync(poolEntry, { recursive: true, force: true });
      rmSync(paths.worktreePoolConfig, { force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].slug).toBe(slug);
      }

      // Symlink was removed
      let symlinkGone = false;
      try {
        lstatSync(wtPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);
    });

    it("skips repo when trees/{repo}/ directory is missing", async () => {
      rmSync(paths.repoDir("myws", "myrepo"), { recursive: true, force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }
    });

    it("does prune orphaned worktrees.json entries with no symlink and no pool dir", async () => {
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

      // Delete both the workspace symlink and the pool dir — orphaned json entry remains
      rmSync(paths.worktreeDir("myws", "myrepo", "feature-x"), { force: true });
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });

      const before = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
      expect(before.myrepo?.["feature-x"]).toContain("myws");

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].slug).toBe("feature-x");
      }

      const after = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
      expect(after.myrepo).toBeUndefined();
    });

    it("does prune dangling linked symlinks when slug does not match default branch", async () => {
      const repoDir = paths.repoDir("myws", "myrepo");
      const wtPath = join(repoDir, "stale-link");
      symlinkSync("does-not-exist", wtPath);

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].repo).toBe("myrepo");
        expect(result.value.pruned[0].slug).toBe("stale-link");
      }

      // Symlink was removed
      let symlinkGone = false;
      try {
        lstatSync(wtPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);
    });

    it("does not prune linked symlinks when target exists", async () => {
      const repoDir = paths.repoDir("myws", "myrepo");
      const existingDir = join(repoDir, "_real-target");
      mkdirSync(existingDir, { recursive: true });
      const wtPath = join(repoDir, "real-link");
      symlinkSync(existingDir, wtPath);

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }

      // Symlink still exists
      expect(lstatSync(wtPath).isSymbolicLink()).toBe(true);
    });

    it("does not prune linked symlinks when default branch cannot be determined", async () => {
      // Create a dangling linked symlink for a non-default slug
      const repoDir = paths.repoDir("myws", "myrepo");
      const wtPath = join(repoDir, "stale-link");
      symlinkSync("does-not-exist", wtPath);

      // Remove the actual git repo directory so getDefaultBranch fails
      rmSync(repoPath, { recursive: true, force: true });

      const result = await pruneWorktrees("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toEqual([]);
      }

      // Symlink still exists (conservative: skip all linked when default unknown)
      expect(lstatSync(wtPath).isSymbolicLink()).toBe(true);
    });

    it("does continue pruning remaining entries when rm fails for one entry", async () => {
      const repo2Path = await createTestGitRepo(tempDir, "myrepo2");
      await addRepo("myws", repo2Path, undefined, paths, GIT_ENV);
      await addWorktree("myws", "myrepo", "feature/perm", { newBranch: true }, paths, GIT_ENV);
      await addWorktree("myws", "myrepo2", "feature/perm", { newBranch: true }, paths, GIT_ENV);

      // Delete both pool entries to make both symlinks dangle
      rmSync(paths.worktreePoolEntry("myrepo", "feature-perm"), {
        recursive: true,
        force: true,
      });
      rmSync(paths.worktreePoolEntry("myrepo2", "feature-perm"), {
        recursive: true,
        force: true,
      });

      // Make myrepo's trees dir read-only so rm on its symlink fails
      const treesDir = paths.repoDir("myws", "myrepo");
      chmodSync(treesDir, 0o555);

      const result = await pruneWorktrees("myws", paths, GIT_ENV);

      // Restore perms before any assertions (so afterEach cleanup works)
      chmodSync(treesDir, 0o755);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only myrepo2's entry was pruned (myrepo's failed with EPERM)
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].repo).toBe("myrepo2");
        expect(result.value.pruned[0].slug).toBe("feature-perm");
      }

      // myrepo's symlink still exists (couldn't be removed)
      expect(lstatSync(paths.worktreeDir("myws", "myrepo", "feature-perm")).isSymbolicLink()).toBe(
        true,
      );

      // myrepo2's symlink is gone
      let myrepo2Gone = false;
      try {
        lstatSync(paths.worktreeDir("myws", "myrepo2", "feature-perm"));
      } catch {
        myrepo2Gone = true;
      }
      expect(myrepo2Gone).toBe(true);
    });
  });

  describe("setup after worktree add", () => {
    it("skips setup when noSetup is true", async () => {
      const result = await addWorktree(
        "myws",
        "myrepo",
        "setup-skip",
        { newBranch: true, noSetup: true },
        paths,
        GIT_ENV,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.setupSkipped).toBe(true);
        expect(result.value.setupResult).toBeUndefined();
      }
    });

    it("skips setup and returns setupSkipped when no ecosystem and no commands.json", async () => {
      // repoPath has no lockfile or commands.json — no ecosystem detected
      const result = await addWorktree(
        "myws",
        "myrepo",
        "setup-no-eco",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.setupSkipped).toBe(true);
        expect(result.value.setupResult).toBeUndefined();
      }
    });

    it("runs setup command from commands.json and captures result", async () => {
      mkdirSync(join(repoPath, ".grove"), { recursive: true });
      writeFileSync(
        join(repoPath, ".grove", "commands.json"),
        JSON.stringify({ setup: ["echo", "setup-ran"] }),
      );
      const result = await addWorktree(
        "myws",
        "myrepo",
        "setup-runs",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.setupResult).toBeDefined();
        expect(result.value.setupResult?.exitCode).toBe(0);
        expect(result.value.setupResult?.stdout.trim()).toBe("setup-ran");
        expect(result.value.setupSkipped).toBeUndefined();
      }
    });

    it("setup failure is non-fatal — worktree is still created", async () => {
      mkdirSync(join(repoPath, ".grove"), { recursive: true });
      writeFileSync(
        join(repoPath, ".grove", "commands.json"),
        JSON.stringify({ setup: ["false"] }),
      );
      const result = await addWorktree(
        "myws",
        "myrepo",
        "setup-fails",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      // Worktree is created successfully despite setup failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.slug).toBe("setup-fails");
        expect(result.value.setupResult).toBeDefined();
        expect(result.value.setupResult?.exitCode).not.toBe(0);
      }
      // Pool entry and workspace symlink exist
      expect(existsSync(paths.worktreePoolEntry("myrepo", "setup-fails"))).toBe(true);
      expect(lstatSync(paths.worktreeDir("myws", "myrepo", "setup-fails")).isSymbolicLink()).toBe(
        true,
      );
    });
  });
});
