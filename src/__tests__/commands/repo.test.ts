import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { addRepo, listRepos, removeRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import {
  cleanup,
  createDetachedGitRepo,
  createTestDir,
  createTestGitRepo,
  GIT_ENV,
  spawnProc,
} from "../helpers";

describe("repo commands", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("myws", paths);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("add creates repo dir and default branch symlink", async () => {
    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // repos/myrepo symlink exists
    expect(existsSync(paths.repoEntry("myrepo"))).toBe(true);
    expect(lstatSync(paths.repoEntry("myrepo")).isSymbolicLink()).toBe(true);

    // {workspace}/trees/myrepo is a directory
    const repoDir = paths.repoDir("myws", "myrepo");
    expect(existsSync(repoDir)).toBe(true);
    expect(lstatSync(repoDir).isDirectory()).toBe(true);
    expect(lstatSync(repoDir).isSymbolicLink()).toBe(false);

    // {workspace}/trees/myrepo/main symlink points to ../../../repos/myrepo
    const defaultSlugPath = join(repoDir, "main");
    expect(lstatSync(defaultSlugPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(defaultSlugPath)).toBe("../../../repos/myrepo");
  });

  it("add then list includes repo", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    const result = await listRepos("myws", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.name)).toContain("myrepo");
    }
  });

  it("add derives name from path basename", async () => {
    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("myrepo");
    }
  });

  it("add with --name overrides derived name", async () => {
    const result = await addRepo("myws", repoPath, "customname", paths, GIT_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("customname");
    }
    expect(existsSync(paths.repoEntry("customname"))).toBe(true);
    // repo dir under trees/ uses the override name
    expect(existsSync(paths.repoDir("myws", "customname"))).toBe(true);
    expect(lstatSync(paths.repoDir("myws", "customname")).isDirectory()).toBe(true);
  });

  it("add fails if path is not a git repo", async () => {
    const plainDir = join(tempDir, "notarepo");
    mkdirSync(plainDir);
    const result = await addRepo("myws", plainDir, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_A_GIT_REPO");
    }
  });

  it("add to second workspace reuses existing global tree symlink", async () => {
    await addWorkspace("otherws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    const result = await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // Only one repos/myrepo entry
    const treeStat = lstatSync(paths.repoEntry("myrepo"));
    expect(treeStat.isSymbolicLink()).toBe(true);

    // Each workspace has its own trees/myrepo directory
    expect(lstatSync(paths.repoDir("myws", "myrepo")).isDirectory()).toBe(true);
    expect(lstatSync(paths.repoDir("otherws", "myrepo")).isDirectory()).toBe(true);

    // Both workspaces have their own default branch symlinks
    const ws1Link = join(paths.repoDir("myws", "myrepo"), "main");
    const ws2Link = join(paths.repoDir("otherws", "myrepo"), "main");
    expect(lstatSync(ws1Link).isSymbolicLink()).toBe(true);
    expect(lstatSync(ws2Link).isSymbolicLink()).toBe(true);
  });

  it("add rejects reserved repo name 'trees'", async () => {
    const result = await addRepo("myws", repoPath, "trees", paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RESERVED_NAME");
    }
  });

  it("add errors if repos/{name} already points to a different path", async () => {
    const otherRepo = await createTestGitRepo(tempDir, "myrepo2");
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    // Try to add a different repo with same derived name "myrepo" (use --name myrepo)
    const result = await addRepo("myws", otherRepo, "myrepo", paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TREE_NAME_CONFLICT");
    }
  });

  it("add is idempotent for same repo and workspace", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // Still only one entry in config
    const list = await listRepos("myws", paths);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.filter((r) => r.name === "myrepo").length).toBe(1);
    }
  });

  it("add creates repos/ directory lazily on first use", async () => {
    expect(existsSync(paths.repos)).toBe(false);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(existsSync(paths.repos)).toBe(true);
  });

  it("remove excludes repo from list but global tree remains", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    const result = await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    const list = await listRepos("myws", paths);
    if (list.ok) {
      expect(list.value.map((r) => r.name)).not.toContain("myrepo");
    }

    // Global repo symlink stays
    expect(existsSync(paths.repoEntry("myrepo"))).toBe(true);

    // Repo dir under trees/ is removed
    expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(false);
  });

  it("remove refuses if real worktrees exist without --force", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    const result = await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_HAS_WORKTREES");
    }
  });

  it("remove --force removes worktrees then repo dir", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    const result = await removeRepo("myws", "myrepo", { force: true }, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(false);
    // Global repo entry stays
    expect(existsSync(paths.repoEntry("myrepo"))).toBe(true);
  });

  it("remove succeeds when repo dir is already missing", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    // Manually remove the repo dir before calling removeRepo
    rmSync(paths.repoDir("myws", "myrepo"), { recursive: true });
    const result = await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    expect(result.ok).toBe(true);
  });

  it("addRepo updates .code-workspace with repo folder", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    const content = JSON.parse(
      require("node:fs").readFileSync(paths.vscodeWorkspace("myws"), "utf-8"),
    );
    expect(content.folders).toHaveLength(2);
    expect(content.folders[1]).toEqual({
      path: "trees/myrepo",
      name: "myrepo",
    });
  });

  it("removeRepo removes repo from .code-workspace", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    const content = JSON.parse(
      require("node:fs").readFileSync(paths.vscodeWorkspace("myws"), "utf-8"),
    );
    expect(content.folders).toHaveLength(1);
    expect(content.folders[0].path).toBe(".");
  });

  it("dangling symlink reported in list status", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    // Remove the actual repo directory to make symlink dangling
    rmSync(repoPath, { recursive: true, force: true });

    const list = await listRepos("myws", paths);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const repo = list.value.find((r) => r.name === "myrepo");
      expect(repo?.status).toBe("dangling");
    }
  });

  it("remove refuses if pool worktrees exist without --force", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/pool", { newBranch: true }, paths, GIT_ENV);

    const result = await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_HAS_WORKTREES");
    }
  });

  it("remove --force cleans up pool worktree", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/pool", { newBranch: true }, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-pool");
    expect(existsSync(poolEntry)).toBe(true);

    const result = await removeRepo("myws", "myrepo", { force: true }, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(false);
    // Pool entry removed since last reference
    expect(existsSync(poolEntry)).toBe(false);
  });

  it("remove --force with shared pool worktree preserves pool entry for other workspace", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorkspace("otherws", paths);
    await addRepo("otherws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/shared", { newBranch: true }, paths, GIT_ENV);
    await addWorktree("otherws", "myrepo", "feature/shared", {}, paths, GIT_ENV);

    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-shared");

    // Remove from myws — pool entry should persist for otherws
    const result = await removeRepo("myws", "myrepo", { force: true }, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // Pool entry persists
    expect(existsSync(poolEntry)).toBe(true);

    // otherws symlink intact
    expect(
      lstatSync(paths.worktreeDir("otherws", "myrepo", "feature-shared")).isSymbolicLink(),
    ).toBe(true);
  });

  it("addRepo rollback: cleans up repoDir and wsTreeEntry when getDefaultBranch fails", async () => {
    // Create a repo and put HEAD in detached state so symbolic-ref fails
    const detachedRepoPath = await createDetachedGitRepo(tempDir, "detached-repo");

    const result = await addRepo("myws", detachedRepoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GIT_DEFAULT_BRANCH_ERROR");
    }

    // Verify cleanup: repo dir should not exist
    expect(existsSync(paths.repoDir("myws", "detached-repo"))).toBe(false);
  });

  it("addRepo rollback: cleans up on config write failure", async () => {
    // Write invalid JSON to workspace.json so addRepoToConfig fails
    writeFileSync(paths.workspaceConfig("myws"), "not-valid-json");

    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(false);

    // Cleanup should have removed the repo dir
    expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(false);
  });

  it("addRepo rejects empty name", async () => {
    const result = await addRepo("myws", repoPath, "", paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_NAME");
    }
  });

  it("addRepo rejects name with path separator", async () => {
    const result = await addRepo("myws", repoPath, "a/b", paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_NAME");
    }
  });

  it("addRepo rejects name with double-dot traversal", async () => {
    const result = await addRepo("myws", repoPath, "a..b", paths, GIT_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_NAME");
    }
  });

  it("does clean metadata-only pool entries when removeRepo --force and symlink missing", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/x", { newBranch: true }, paths, GIT_ENV);

    // Externally delete the workspace symlink — metadata entry remains in worktrees.json
    rmSync(paths.worktreeDir("myws", "myrepo", "feature-x"), { force: true });

    const before = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(before.myrepo?.["feature-x"]).toContain("myws");

    const result = await removeRepo("myws", "myrepo", { force: true }, paths, GIT_ENV);
    expect(result.ok).toBe(true);

    // worktrees.json should be cleaned
    const after = JSON.parse(readFileSync(paths.worktreePoolConfig, "utf-8"));
    expect(after.myrepo).toBeUndefined();
  });

  it("addRepo generates trees.md", async () => {
    writeFileSync(join(repoPath, "CLAUDE.md"), "# myrepo\n");
    const result = await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    expect(result.ok).toBe(true);
    expect(existsSync(paths.claudeTreesMd("myws"))).toBe(true);
    const content = readFileSync(paths.claudeTreesMd("myws"), "utf-8");
    expect(content).toContain("@../trees/myrepo/main/CLAUDE.md");
  });

  it("removeRepo updates trees.md", async () => {
    const repoPath2 = await createTestGitRepo(tempDir, "other");
    writeFileSync(join(repoPath, "CLAUDE.md"), "# myrepo\n");
    writeFileSync(join(repoPath2, "CLAUDE.md"), "# other\n");
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addRepo("myws", repoPath2, undefined, paths, GIT_ENV);

    const before = readFileSync(paths.claudeTreesMd("myws"), "utf-8");
    expect(before).toContain("myrepo");
    expect(before).toContain("other");

    await removeRepo("myws", "myrepo", {}, paths, GIT_ENV);
    const after = readFileSync(paths.claudeTreesMd("myws"), "utf-8");
    expect(after).not.toContain("myrepo");
    expect(after).toContain("other");
  });

  it("does remove repoDir and deregister repo when gitWarning occurs during removeRepo --force", async () => {
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "myrepo", "feature/pool", { newBranch: true }, paths, GIT_ENV);

    // Lock the worktree — git worktree remove --force on a locked worktree fails (requires -f -f).
    // This reliably produces a gitWarning even when force: true is used.
    const poolEntry = paths.worktreePoolEntry("myrepo", "feature-pool");
    await spawnProc(["git", "-C", repoPath, "worktree", "lock", poolEntry], undefined, GIT_ENV);

    // removeRepo --force: git warns but repoDir and workspace.json must still be cleaned
    const result = await removeRepo("myws", "myrepo", { force: true }, paths, GIT_ENV);

    // Function may return ok or WORKTREE_REMOVE_FAILED, but repoDir must be gone
    expect(existsSync(paths.repoDir("myws", "myrepo"))).toBe(false);
    // Repo must be deregistered from workspace.json
    const config = JSON.parse(readFileSync(paths.workspaceConfig("myws"), "utf-8"));
    expect(config.repos.find((r: { name: string }) => r.name === "myrepo")).toBeUndefined();
    // Result may be ok or error — but if error it must be WORKTREE_REMOVE_FAILED
    if (!result.ok) {
      expect(result.code).toBe("WORKTREE_REMOVE_FAILED");
    }
  });
});
