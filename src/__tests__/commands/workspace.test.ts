import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { addRepo } from "../../commands/repo";
import {
  addWorkspace,
  listWorkspaces,
  removeWorkspace,
  syncWorkspace,
} from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("workspace commands", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("add then list includes workspace", async () => {
    const result = await addWorkspace("myws", paths);
    expect(result.ok).toBe(true);

    const list = await listWorkspaces(paths);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.map((w) => w.name)).toContain("myws");
    }
  });

  it("add fails if workspace already exists", async () => {
    await addWorkspace("myws", paths);
    const result = await addWorkspace("myws", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_EXISTS");
    }
  });

  it("add rejects reserved name 'repos'", async () => {
    const result = await addWorkspace("repos", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RESERVED_NAME");
    }
  });

  it("add rejects reserved name 'worktrees'", async () => {
    const result = await addWorkspace("worktrees", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RESERVED_NAME");
    }
  });

  it("add rejects name with slash", async () => {
    const result = await addWorkspace("a/b", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_NAME");
    }
  });

  it("add rejects empty name", async () => {
    const result = await addWorkspace("", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_NAME");
    }
  });

  it("list returns empty array when root does not exist", async () => {
    const result = await listWorkspaces(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("list skips non-directory entries", async () => {
    await addWorkspace("myws", paths);
    // Create a file (not a dir) in root
    writeFileSync(join(paths.root, "notadir"), "file");
    const result = await listWorkspaces(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((w) => w.name)).toContain("myws");
      expect(result.value.map((w) => w.name)).not.toContain("notadir");
    }
  });

  it("list skips reserved names", async () => {
    await addWorkspace("myws", paths);
    mkdirSync(join(paths.root, "repos"), { recursive: true });
    mkdirSync(join(paths.root, "worktrees"), { recursive: true });
    const result = await listWorkspaces(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.map((w) => w.name);
      expect(names).not.toContain("repos");
      expect(names).not.toContain("worktrees");
    }
  });

  it("list skips directories without workspace.json", async () => {
    await addWorkspace("myws", paths);
    // Create a directory without workspace.json
    mkdirSync(join(paths.root, "noconfig"), { recursive: true });
    const result = await listWorkspaces(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((w) => w.name)).not.toContain("noconfig");
    }
  });

  it("remove workspace without repos succeeds", async () => {
    await addWorkspace("myws", paths);
    const result = await removeWorkspace("myws", {}, paths);
    expect(result.ok).toBe(true);

    const list = await listWorkspaces(paths);
    if (list.ok) {
      expect(list.value.map((w) => w.name)).not.toContain("myws");
    }
  });

  it("remove non-existent workspace returns error", async () => {
    const result = await removeWorkspace("ghost", {}, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_NOT_FOUND");
    }
  });

  it("remove refuses if workspace has repos without --force", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

    const result = await removeWorkspace("myws", {}, paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_HAS_REPOS");
    }
  });

  it("remove --force removes workspace even with repos", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

    const result = await removeWorkspace("myws", { force: true }, paths);
    expect(result.ok).toBe(true);
    expect(existsSync(paths.workspace("myws"))).toBe(false);
  });

  it("remove --force cleans up pool worktrees", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-x");
    expect(existsSync(poolEntry)).toBe(true);

    const result = await removeWorkspace("myws", { force: true }, paths);
    expect(result.ok).toBe(true);

    // Pool entry removed since last reference
    expect(existsSync(poolEntry)).toBe(false);
  });

  it("remove --force with shared pool entry preserves pool for other workspace", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addWorkspace("otherws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-shared");

    const result = await removeWorkspace("myws", { force: true }, paths);
    expect(result.ok).toBe(true);

    // Pool entry persists for otherws
    expect(existsSync(poolEntry)).toBe(true);
  });

  it("does clean metadata-only pool entries when removeWorkspace --force and symlink missing", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    // Externally delete the workspace symlink — metadata entry remains in worktrees.json
    rmSync(paths.worktreeDir("myws", "myrepo", "feature-x"), { force: true });

    const before = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(before.myrepo?.["feature-x"]).toContain("myws");

    const result = await removeWorkspace("myws", { force: true }, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // worktrees.json should be cleaned
    const after = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(after.myrepo).toBeUndefined();
  });

  it("does remove workspace directory when gitWarning occurs during removeWorkspace --force", async () => {
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/pool", { newBranch: true }, paths, GIT_ENV);

    // Lock the worktree — git worktree remove --force on a locked worktree fails (requires -f -f).
    // This reliably produces a gitWarning even when force: true is used.
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-pool");
    Bun.spawnSync(["git", "-C", repoPath, "worktree", "lock", poolEntry], {
      env: GIT_ENV,
    });

    // removeWorkspace --force: even if git reports a warning, workspace directory must be removed
    await removeWorkspace("myws", { force: true }, paths, GIT_ENV);

    expect(existsSync(paths.workspace("myws"))).toBe(false);
  });

  it("add creates workspace.json, .code-workspace, and trees.md", async () => {
    await addWorkspace("myws", paths);
    expect(existsSync(paths.workspaceConfig("myws"))).toBe(true);
    expect(existsSync(paths.vscodeWorkspace("myws"))).toBe(true);
    expect(existsSync(paths.claudeTreesMd("myws"))).toBe(true);
  });

  it("add creates CLAUDE.md in .claude/", async () => {
    await addWorkspace("myws", paths);
    expect(existsSync(paths.claudeMd("myws"))).toBe(true);
  });

  describe("syncWorkspace", () => {
    it("returns WORKSPACE_NOT_FOUND for non-existent workspace", async () => {
      const result = await syncWorkspace("ghost", paths);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("WORKSPACE_NOT_FOUND");
      }
    });

    it("returns ok for empty workspace", async () => {
      await addWorkspace("myws", paths);
      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.repos).toEqual([]);
      }
    });

    it("reports dangling status for repos whose source path is not a git repo", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
      // Remove the actual repo
      rmSync(repoPath, { recursive: true, force: true });

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.status).toBe("dangling");
      }
    });

    it("repairs missing repos/ symlink", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

      // Break the repos/ symlink
      rmSync(paths.repoEntry("myrepo"), { force: true });
      expect(existsSync(paths.repoEntry("myrepo"))).toBe(false);

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      expect(existsSync(paths.repoEntry("myrepo"))).toBe(true);

      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.status).toBe("repaired");
        expect(repo?.repairs).toContain("created repos/myrepo");
      }
    });

    it("repairs missing trees/{repo}/ directory", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

      // Remove the trees directory
      rmSync(paths.repoDir("myws", "myrepo"), { recursive: true, force: true });

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(true);

      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.repairs).toContain("created trees/myrepo/");
      }
    });

    it("repairs missing default-branch symlink", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

      const slugPath = join(paths.repoDir("myws", "myrepo"), "main");
      rmSync(slugPath, { force: true });

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      expect(existsSync(slugPath) || lstatSync(slugPath) !== null).toBeTruthy();

      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.repairs).toContain("created trees/myrepo/main");
      }
    });

    it("re-creates dangling repos/ symlink (pointing to a different path)", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

      // Replace repos/myrepo with a symlink to a non-existent path
      rmSync(paths.repoEntry("myrepo"), { force: true });
      symlinkSync("/nonexistent/path", paths.repoEntry("myrepo"));

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      // Now the symlink should point to the actual repo
      expect(realpathSync(paths.repoEntry("myrepo"))).toBe(realpathSync(repoPath));

      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.repairs).toContain("created repos/myrepo");
      }
    });

    it("returns ok status when everything is already correct", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const repo = result.value.repos.find((r) => r.name === "myrepo");
        expect(repo?.status).toBe("ok");
        expect(repo?.repairs).toEqual([]);
      }
    });

    it("prunes dangling pool symlinks during sync", async () => {
      const repoPath = await createTestGitRepo(tempDir, "myrepo");
      await addWorkspace("myws", paths);
      await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
      await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

      // Delete pool entry to make workspace symlink dangle
      rmSync(paths.worktreePoolEntry("myrepo", "feature-x"), {
        recursive: true,
        force: true,
      });

      const result = await syncWorkspace("myws", paths, GIT_ENV);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pruned).toHaveLength(1);
        expect(result.value.pruned[0].slug).toBe("feature-x");
      }
    });
  });
});
