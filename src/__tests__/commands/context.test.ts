import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getTargetContext, getWorkspaceContext } from "../../commands/context";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("context command", () => {
  let tempDir: string;
  let repoPath: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    repoPath = await createTestGitRepo(tempDir, "api");
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("myws", paths);
    await addRepo("myws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("myws", "api", "feature/auth", { newBranch: true }, paths, GIT_ENV);
  });

  afterEach(() => cleanup(tempDir));

  it("indexes instruction scopes across workspace worktrees without loading content", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# feature root\n");
    await mkdir(join(featureRoot, "packages", "auth"), { recursive: true });
    await writeFile(join(featureRoot, "packages", "auth", "AGENTS.md"), "# auth package\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.mode).toBe("workspace");
    expect(result.value.workspace.name).toBe("myws");
    expect(result.value.worktrees.map((w) => `${w.repo}/${w.slug}`)).toContain("api/feature-auth");
    expect(result.value.index.map((entry) => entry.scope)).toEqual([
      "api/feature-auth",
      "api/feature-auth/packages/auth",
    ]);
    expect(result.value.index[0].loadCommand).toBe("grove ws context trees/api/feature-auth");
    expect(result.value.index[0]).not.toHaveProperty("content");
  });

  it("uses AGENTS.override.md before AGENTS.md before CLAUDE.md in the index", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(root, "CLAUDE.md"), "# claude\n");
    await writeFile(join(root, "AGENTS.md"), "# agents\n");
    await writeFile(join(root, "AGENTS.override.md"), "# override\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index).toHaveLength(1);
    expect(result.value.index[0].sourcePath).toBe("trees/api/feature-auth/AGENTS.override.md");
    expect(result.value.index[0].kind).toBe("AGENTS.override.md");
  });

  it("computes a deterministic SHA-256 hash for instruction content", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(root, "AGENTS.md"), "known content\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index[0].hash).toBe(
      "a5e29604a88ef9dace3ea3de21aa0cfb09946846146070b9a9fe17f2f9701212",
    );
  });

  it("indexes symlinked instruction files that point to real files", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(root, "shared-instructions.md"), "# shared\n");
    await symlink("shared-instructions.md", join(root, "AGENTS.md"));

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index).toHaveLength(1);
    expect(result.value.index[0].sourcePath).toBe("trees/api/feature-auth/AGENTS.md");
    expect(result.value.skipped).toEqual([]);
  });

  it("records dangling instruction symlinks as skipped", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await symlink("missing.md", join(root, "AGENTS.md"));

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index).toEqual([]);
    expect(result.value.skipped.map((entry) => entry.path)).toContain(
      "trees/api/feature-auth/AGENTS.md",
    );
  });

  it("does not descend into .git or node_modules directories", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await mkdir(join(root, "packages", ".git", "hooks"), { recursive: true });
    await writeFile(join(root, "packages", ".git", "hooks", "AGENTS.md"), "# git hooks\n");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "AGENTS.md"), "# dependency\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index).toEqual([]);
    expect(result.value.skipped).toEqual([]);
  });

  it("records unclassifiable worktree entries as skipped", async () => {
    await writeFile(join(paths.repoDir("myws", "api"), "not-a-worktree"), "not a directory\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.skipped.map((entry) => entry.path)).toContain("trees/api/not-a-worktree");
  });

  it("loads root-to-leaf instructions for a target file", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# feature root\n");
    await mkdir(join(featureRoot, "packages", "auth"), { recursive: true });
    await writeFile(join(featureRoot, "packages", "auth", "AGENTS.md"), "# auth package\n");
    await writeFile(join(featureRoot, "packages", "auth", "login.ts"), "export const x = 1;\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth/packages/auth/login.ts",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.mode).toBe("target");
    expect(result.value.repo).toBe("api");
    expect(result.value.slug).toBe("feature-auth");
    expect(result.value.worktreePath).toBe("trees/api/feature-auth");
    expect(result.value.loadedScope).toBe("trees/api/feature-auth/packages/auth");
    expect(result.value.contextKey).toBe("myws/api/feature-auth/packages/auth");
    expect(result.value.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.sources.map((source) => source.path)).toEqual([
      "trees/api/feature-auth/AGENTS.md",
      "trees/api/feature-auth/packages/auth/AGENTS.md",
    ]);
    expect(result.value.sources.map((source) => source.content)).toEqual([
      "# feature root\n",
      "# auth package\n",
    ]);
  });

  it("uses CLAUDE.md as same-directory fallback only", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "CLAUDE.md"), "# claude root\n");
    await mkdir(join(featureRoot, "packages"), { recursive: true });
    await writeFile(join(featureRoot, "packages", "AGENTS.md"), "# package agents\n");
    await writeFile(join(featureRoot, "packages", "CLAUDE.md"), "# package claude\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth/packages",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sources.map((source) => source.path)).toEqual([
      "trees/api/feature-auth/CLAUDE.md",
      "trees/api/feature-auth/packages/AGENTS.md",
    ]);
  });

  it("returns CONTEXT_TARGET_AMBIGUOUS for a repo container target", async () => {
    const result = await getTargetContext("myws", "trees/api", paths.workspace("myws"), paths);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONTEXT_TARGET_AMBIGUOUS");
      expect(result.error).toContain("feature-auth");
    }
  });

  it("returns WORKTREE_NOT_FOUND for an unknown slug", async () => {
    const result = await getTargetContext(
      "myws",
      "trees/api/missing",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKTREE_NOT_FOUND");
    }
  });

  it("returns REPO_NOT_FOUND for an unknown repo", async () => {
    const result = await getTargetContext(
      "myws",
      "trees/missing/feature-auth",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REPO_NOT_FOUND");
    }
  });

  it("returns CONTEXT_TARGET_NOT_FOUND for a directory symlink that escapes the worktree", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    const outside = join(tempDir, "outside-worktree");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "AGENTS.md"), "# outside\n");
    await symlink(outside, join(featureRoot, "external"));

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth/external",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONTEXT_TARGET_NOT_FOUND");
    }
  });

  it("resolves an absolute workspace-tree target path", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# absolute\n");

    const result = await getTargetContext("myws", featureRoot, paths.workspace("myws"), paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.worktreePath).toBe("trees/api/feature-auth");
    expect(result.value.loadedScope).toBe("trees/api/feature-auth");
    expect(result.value.sources[0].content).toBe("# absolute\n");
  });

  it("resolves a relative target from inside a nested worktree cwd", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    const nested = join(featureRoot, "packages", "auth");
    await mkdir(nested, { recursive: true });
    await writeFile(join(featureRoot, "AGENTS.md"), "# root\n");
    await writeFile(join(nested, "AGENTS.md"), "# nested\n");
    await writeFile(join(nested, "login.ts"), "export const x = 1;\n");

    const result = await getTargetContext("myws", "login.ts", nested, paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.loadedScope).toBe("trees/api/feature-auth/packages/auth");
    expect(result.value.sources.map((source) => source.content)).toEqual([
      "# root\n",
      "# nested\n",
    ]);
  });

  it("changes contextHash when selected instruction content changes", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# first\n");

    const first = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );
    await writeFile(join(featureRoot, "AGENTS.md"), "# second\n");
    const second = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.value.contextHash).not.toBe(second.value.contextHash);
  });

  it("changes contextHash when deepest effective scope changes", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    const nested = join(featureRoot, "packages");
    await mkdir(nested, { recursive: true });
    await writeFile(join(featureRoot, "AGENTS.md"), "# root\n");
    await writeFile(join(nested, "AGENTS.md"), "# nested\n");

    const root = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );
    const packageDir = await getTargetContext(
      "myws",
      "trees/api/feature-auth/packages",
      paths.workspace("myws"),
      paths,
    );

    expect(root.ok).toBe(true);
    expect(packageDir.ok).toBe(true);
    if (!root.ok || !packageDir.ok) {
      return;
    }
    expect(root.value.loadedScope).toBe("trees/api/feature-auth");
    expect(packageDir.value.loadedScope).toBe("trees/api/feature-auth/packages");
    expect(root.value.contextHash).not.toBe(packageDir.value.contextHash);
  });

  it("resolves a direct pool worktree path back to the workspace tree", async () => {
    const featureRoot = paths.worktreePoolEntry("api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# pool path\n");

    const result = await getTargetContext("myws", featureRoot, paths.workspace("myws"), paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.worktreePath).toBe("trees/api/feature-auth");
    expect(result.value.loadedScope).toBe("trees/api/feature-auth");
    expect(result.value.sources[0].path).toBe("trees/api/feature-auth/AGENTS.md");
  });

  it("uses the worktree root as loaded scope when no instructions are found", async () => {
    await mkdir(join(paths.worktreeDir("myws", "api", "feature-auth"), "empty"), {
      recursive: true,
    });

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth/empty",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.loadedScope).toBe("trees/api/feature-auth");
    expect(result.value.contextKey).toBe("myws/api/feature-auth");
    expect(result.value.sources).toEqual([]);
  });
});
