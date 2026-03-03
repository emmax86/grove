import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { addRepo, listRepos } from "../../commands/repo";
import { getStatus } from "../../commands/status";
import { addWorkspace, listWorkspaces } from "../../commands/workspace";
import { addWorktree, listWorktrees, removeWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { generateClaudeFiles } from "../../lib/claude";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("lifecycle integration", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeAll(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "myrepo");
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterAll(() => {
    cleanup(tempDir);
  });

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
    expect(existsSync(paths.repoEntry("myrepo"))).toBe(true);

    // default branch symlink exists in workspace
    const defaultBranchPath = join(paths.repoDir("myws", "myrepo"), "main");
    const stat = lstatSync(defaultBranchPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // full chain: {workspace}/trees/myrepo/main -> ../../../repos/myrepo -> actual path
    expect(realpathSync(defaultBranchPath)).toBe(realpathSync(repoPath));
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

    expect(existsSync(poolEntry)).toBe(true);
    expect(lstatSync(poolEntry).isDirectory()).toBe(true);
    expect(lstatSync(poolEntry).isSymbolicLink()).toBe(false);

    expect(lstatSync(wsEntry).isSymbolicLink()).toBe(true);
    // Symlink points into the pool
    const target = readlinkSync(wsEntry);
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

    // Workspace symlink removed
    const wsEntry = paths.worktreeDir("myws", "myrepo", "feature-test");
    let gone = false;
    try {
      lstatSync(wsEntry);
    } catch {
      gone = true;
    }
    expect(gone).toBe(true);

    // Pool entry removed (last reference)
    expect(existsSync(paths.worktreePoolEntry("myrepo", "feature-test"))).toBe(false);
  });

  it("worktree no longer in list after removal", async () => {
    const result = await listWorktrees("myws", "myrepo", paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((w) => w.slug)).not.toContain("feature-test");
    }
  });
});

describe("generateClaudeFiles — trees.md", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;

  beforeAll(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterAll(() => cleanup(tempDir));

  describe("golden format", () => {
    beforeAll(async () => {
      const repoA = await createTestGitRepo(tempDir, "golden-alpha");
      const repoB = await createTestGitRepo(tempDir, "golden-bravo");
      writeFileSync(join(repoA, "CLAUDE.md"), "# Alpha\n");
      writeFileSync(join(repoB, "CLAUDE.md"), "# Bravo\n");
      await addWorkspace("ws-golden", paths);
      await addRepo("ws-golden", repoA, undefined, paths, GIT_ENV);
      await addRepo("ws-golden", repoB, undefined, paths, GIT_ENV);
    });

    it("produces exact trees.md with sorted repos and comment lines", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-golden"), "utf8");
      expect(content).toBe(
        "# Generated by grove — do not edit manually\n" +
          "# golden-alpha/main\n" +
          "@../trees/golden-alpha/main/CLAUDE.md\n" +
          "# golden-bravo/main\n" +
          "@../trees/golden-bravo/main/CLAUDE.md\n",
      );
    });
  });

  describe("dedup — identical content annotates canonical with deduped slugs", () => {
    const CONTENT = "# Same content\n";

    beforeAll(async () => {
      const repoPath = await createTestGitRepo(tempDir, "dup-same");
      writeFileSync(join(repoPath, "CLAUDE.md"), CONTENT);
      await addWorkspace("ws-dup-same", paths);
      await addRepo("ws-dup-same", repoPath, undefined, paths, GIT_ENV);
      await addWorktree(
        "ws-dup-same",
        "dup-same",
        "feature/x",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      writeFileSync(join(paths.worktreePoolEntry("dup-same", "feature-x"), "CLAUDE.md"), CONTENT);
      await generateClaudeFiles("ws-dup-same", paths, GIT_ENV);
    });

    it("annotates the canonical slug when a duplicate is found", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-dup-same"), "utf8");
      expect(content).toContain("# dup-same/main (also: feature-x)\n");
    });

    it("emits only one @reference for the canonical slug", () => {
      const lines = readFileSync(paths.claudeTreesMd("ws-dup-same"), "utf8")
        .split("\n")
        .filter((l) => l.startsWith("@"));
      expect(lines).toEqual(["@../trees/dup-same/main/CLAUDE.md"]);
    });
  });

  describe("dedup — different content keeps both entries", () => {
    beforeAll(async () => {
      const repoPath = await createTestGitRepo(tempDir, "dup-diff");
      writeFileSync(join(repoPath, "CLAUDE.md"), "# Main content\n");
      await addWorkspace("ws-dup-diff", paths);
      await addRepo("ws-dup-diff", repoPath, undefined, paths, GIT_ENV);
      await addWorktree(
        "ws-dup-diff",
        "dup-diff",
        "feature/y",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      writeFileSync(
        join(paths.worktreePoolEntry("dup-diff", "feature-y"), "CLAUDE.md"),
        "# Feature content\n",
      );
      await generateClaudeFiles("ws-dup-diff", paths, GIT_ENV);
    });

    it("includes both entries when content differs", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-dup-diff"), "utf8");
      expect(content).toContain("# dup-diff/main\n");
      expect(content).toContain("# dup-diff/feature-y\n");
    });

    it("omits the annotation when there are no duplicates", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-dup-diff"), "utf8");
      expect(content).not.toContain("also:");
    });
  });

  describe("dedup — multiple identical slugs appear sorted in annotation", () => {
    const CONTENT = "# Shared\n";

    beforeAll(async () => {
      const repoPath = await createTestGitRepo(tempDir, "multi-dup");
      writeFileSync(join(repoPath, "CLAUDE.md"), CONTENT);
      await addWorkspace("ws-multi-dup", paths);
      await addRepo("ws-multi-dup", repoPath, undefined, paths, GIT_ENV);
      await addWorktree(
        "ws-multi-dup",
        "multi-dup",
        "feature/zzz",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      await addWorktree(
        "ws-multi-dup",
        "multi-dup",
        "feature/aaa",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      writeFileSync(
        join(paths.worktreePoolEntry("multi-dup", "feature-zzz"), "CLAUDE.md"),
        CONTENT,
      );
      writeFileSync(
        join(paths.worktreePoolEntry("multi-dup", "feature-aaa"), "CLAUDE.md"),
        CONTENT,
      );
      await generateClaudeFiles("ws-multi-dup", paths, GIT_ENV);
    });

    it("lists deduped slugs alphabetically within the annotation", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-multi-dup"), "utf8");
      expect(content).toContain("# multi-dup/main (also: feature-aaa, feature-zzz)\n");
    });
  });

  describe("dedup — no cross-repo dedup for identical content", () => {
    const CONTENT = "# Identical across repos\n";

    beforeAll(async () => {
      const repoA = await createTestGitRepo(tempDir, "cross-a");
      const repoB = await createTestGitRepo(tempDir, "cross-b");
      writeFileSync(join(repoA, "CLAUDE.md"), CONTENT);
      writeFileSync(join(repoB, "CLAUDE.md"), CONTENT);
      await addWorkspace("ws-cross", paths);
      await addRepo("ws-cross", repoA, undefined, paths, GIT_ENV);
      await addRepo("ws-cross", repoB, undefined, paths, GIT_ENV);
    });

    it("includes both repos even when their CLAUDE.md content is identical", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-cross"), "utf8");
      expect(content).toContain("@../trees/cross-a/main/CLAUDE.md");
      expect(content).toContain("@../trees/cross-b/main/CLAUDE.md");
    });
  });

  describe("dedup — feature branch included when default has no CLAUDE.md", () => {
    beforeAll(async () => {
      const repoPath = await createTestGitRepo(tempDir, "no-main-claude");
      await addWorkspace("ws-no-main", paths);
      await addRepo("ws-no-main", repoPath, undefined, paths, GIT_ENV);
      await addWorktree(
        "ws-no-main",
        "no-main-claude",
        "feature/only",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      writeFileSync(
        join(paths.worktreePoolEntry("no-main-claude", "feature-only"), "CLAUDE.md"),
        "# Feature only\n",
      );
      await generateClaudeFiles("ws-no-main", paths, GIT_ENV);
    });

    it("includes the feature branch when the default branch has no CLAUDE.md", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-no-main"), "utf8");
      expect(content).toContain("@../trees/no-main-claude/feature-only/CLAUDE.md");
    });

    it("omits the default branch entry when it has no CLAUDE.md", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-no-main"), "utf8");
      expect(content).not.toContain("no-main-claude/main");
    });
  });

  describe("dedup — default branch wins over alphabetically-earlier slug", () => {
    const CONTENT = "# Same\n";

    beforeAll(async () => {
      const repoPath = await createTestGitRepo(tempDir, "default-wins");
      writeFileSync(join(repoPath, "CLAUDE.md"), CONTENT);
      await addWorkspace("ws-default-wins", paths);
      await addRepo("ws-default-wins", repoPath, undefined, paths, GIT_ENV);
      await addWorktree(
        "ws-default-wins",
        "default-wins",
        "aaa-first",
        { newBranch: true },
        paths,
        GIT_ENV,
      );
      writeFileSync(
        join(paths.worktreePoolEntry("default-wins", "aaa-first"), "CLAUDE.md"),
        CONTENT,
      );
      await generateClaudeFiles("ws-default-wins", paths, GIT_ENV);
    });

    it("uses main as canonical even when another slug is alphabetically earlier", () => {
      const content = readFileSync(paths.claudeTreesMd("ws-default-wins"), "utf8");
      expect(content).toContain("# default-wins/main (also: aaa-first)\n");
      expect(content).not.toContain("# default-wins/aaa-first");
    });
  });
});
