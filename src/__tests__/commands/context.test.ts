import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getTargetContext, getWorkspaceContext, touchContext } from "../../commands/context";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { ContextLedger } from "../../lib/context-ledger";
import { DisclosureRecorder } from "../../lib/context-state";
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
    expect(result.value.index[0].loadCommand).toBe("grove ws context myws trees/api/feature-auth");
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

  it("does not fall back to lower-priority index instructions when override exists but is unreadable", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await symlink("missing.md", join(root, "AGENTS.override.md"));
    await writeFile(join(root, "AGENTS.md"), "# agents\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index.map((entry) => entry.sourcePath)).not.toContain(
      "trees/api/feature-auth/AGENTS.md",
    );
    const skipped = result.value.skipped.find(
      (entry) => entry.path === "trees/api/feature-auth/AGENTS.override.md",
    );
    expect(skipped?.reason).toContain("ENOENT");
  });

  it("does not fall back to lower-priority target instructions when override exists but is unreadable", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    await symlink("missing.md", join(root, "AGENTS.override.md"));
    await writeFile(join(root, "AGENTS.md"), "# agents\n");
    await writeFile(join(root, "login.ts"), "export const x = 1;\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth/login.ts",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sources.map((source) => source.sourcePath)).not.toContain(
      "trees/api/feature-auth/AGENTS.md",
    );
    const skipped = result.value.skipped.find(
      (entry) => entry.path === "trees/api/feature-auth/AGENTS.override.md",
    );
    expect(skipped?.reason).toContain("ENOENT");
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

  it("exposes workspace instructions with graph provenance when present", async () => {
    await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
    await writeFile(paths.workspaceInstructions("myws"), "# workspace\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workspaceInstructions?.sourcePath).toBe(".grove/instructions.md");
    expect(result.value.workspaceInstructions?.path).toBe(".grove/instructions.md");
    expect(result.value.workspaceInstructions?.kind).toBe("workspace");
    expect(result.value.workspaceInstructions?.layer).toBe("workspace");
    expect(result.value.workspaceInstructions?.ownership).toBe("user");
    expect(result.value.workspaceInstructions?.selectionReason).toBe("workspace instruction file");
    expect(result.value.workspaceInstructions?.contentHash).toBe(
      result.value.workspaceInstructions?.hash,
    );
    expect(result.value.workspaceInstructions).not.toHaveProperty("provenanceHash");
    expect(result.value.graph.root).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.graph.nodes.some((node) => node.id === "workspace:myws")).toBe(true);
    const instructionNode = result.value.graph.nodes.find(
      (node) =>
        node.kind === "instruction" &&
        node.path === ".grove/instructions.md" &&
        node.scope === "workspace",
    );
    expect(instructionNode).toBeDefined();
    expect(instructionNode).not.toHaveProperty("inputHashes");
    expect(instructionNode).not.toHaveProperty("dependencies");
  });

  it("records unreadable workspace instructions as skipped without blocking target instructions", async () => {
    await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
    await symlink("missing.md", paths.workspaceInstructions("myws"));
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# target\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sources.map((source) => source.path)).toEqual([
      "trees/api/feature-auth/AGENTS.md",
    ]);
    expect(result.value.skipped.find((entry) => entry.path === ".grove/instructions.md")).toEqual(
      expect.objectContaining({ reason: expect.stringContaining("ENOENT") }),
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
    // git itself refuses to track paths under a nested ".git" directory; node_modules/
    // is excluded here via .gitignore, matching real-world repo convention now that
    // workspace indexing enumerates via git rather than a hardcoded directory-name walk.
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
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

  it("does not descend into nested .worktrees directories when indexing workspace context", async () => {
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    // .worktrees/ is excluded via .gitignore, matching real-world convention for a
    // directory holding nested worktree checkouts, now that workspace indexing
    // enumerates via git rather than a hardcoded directory-name walk.
    await writeFile(join(root, ".gitignore"), ".worktrees/\n");
    await mkdir(join(root, ".worktrees", "nested"), { recursive: true });
    await writeFile(join(root, ".worktrees", "nested", "AGENTS.md"), "# nested worktree\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index).toEqual([]);
    expect(result.value.skipped).toEqual([]);
  });

  it("workspace indexing excludes gitignored directories via git enumeration", async () => {
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, ".gitignore"), ".venv/\n");
    await writeFile(join(featureRoot, "AGENTS.md"), "# feature root\n");
    await mkdir(join(featureRoot, "src", "lib"), { recursive: true });
    await writeFile(join(featureRoot, "src", "lib", "AGENTS.md"), "# lib\n");
    await mkdir(join(featureRoot, ".venv"), { recursive: true });
    await writeFile(join(featureRoot, ".venv", "AGENTS.md"), "# venv\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scopes = result.value.index.map((entry) => entry.sourcePath);
    expect(scopes).toContain("trees/api/feature-auth/AGENTS.md");
    expect(scopes).toContain("trees/api/feature-auth/src/lib/AGENTS.md");
    expect(scopes.some((s) => s.includes(".venv"))).toBe(false);
  });

  it("falls back to the directory walk for a non-git worktree directory", async () => {
    const manualRoot = paths.worktreeDir("myws", "api", "manual");
    await mkdir(manualRoot, { recursive: true });
    await writeFile(join(manualRoot, "AGENTS.md"), "# manual\n");

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index.map((entry) => entry.sourcePath)).toContain(
      "trees/api/manual/AGENTS.md",
    );
    expect(result.value.skipped).toContainEqual(
      expect.objectContaining({
        path: "trees/api/manual",
        reason: expect.stringContaining("git enumeration failed"),
      }),
    );
  });

  it("does not index or special-case symlinked subdirectories under git enumeration", async () => {
    // Spec (Ignore rules): the symlinked-directory special-casing disappears for the
    // git path — git does not traverse directory symlinks, so the escaping symlink is
    // simply absent from the index and no "Symlinked directory not indexed" skip is
    // produced. The security rationale (no traversal outside the worktree) is preserved
    // structurally. The walk retains the special-case as a fallback (covered below).
    const root = paths.worktreeDir("myws", "api", "feature-auth");
    const shared = join(tempDir, "shared");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "AGENTS.md"), "# shared\n");
    await symlink(shared, join(root, "shared"));

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index.map((entry) => entry.scope)).not.toContain("api/feature-auth/shared");
    expect(result.value.skipped).not.toContainEqual({
      path: "trees/api/feature-auth/shared",
      reason: "Symlinked directory not indexed",
    });
  });

  it("records symlinked subdirectories as skipped via the walk fallback for a non-git worktree", async () => {
    // The walk fallback (used when git enumeration fails, e.g. a non-git worktree dir)
    // keeps the symlinked-directory skip diagnostic per the spec.
    const manualRoot = paths.worktreeDir("myws", "api", "manual");
    await mkdir(manualRoot, { recursive: true });
    const shared = join(tempDir, "shared-manual");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "AGENTS.md"), "# shared\n");
    await symlink(shared, join(manualRoot, "shared"));

    const result = await getWorkspaceContext("myws", paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.index.map((entry) => entry.scope)).not.toContain("api/manual/shared");
    expect(result.value.skipped).toContainEqual({
      path: "trees/api/manual/shared",
      reason: "Symlinked directory not indexed",
    });
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

  it("loads workspace instructions before target worktree instructions", async () => {
    await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
    await writeFile(paths.workspaceInstructions("myws"), "# workspace\n");
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# target\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sources.map((source) => source.path)).toEqual([
      ".grove/instructions.md",
      "trees/api/feature-auth/AGENTS.md",
    ]);
    expect(result.value.sources.map((source) => source.layer)).toEqual(["workspace", "target"]);
    expect(result.value.sources.map((source) => source.ownership)).toEqual(["user", "user"]);
    expect(result.value.sources[0].kind).toBe("workspace");
    expect(result.value.sources[1].kind).toBe("AGENTS.md");
    expect(result.value.graph.root).toBe(result.value.contextHash);
    expect(result.value.graph.nodes.every((node) => !("provenanceHash" in node))).toBe(true);
    expect(
      result.value.graph.nodes.some(
        (node) =>
          node.kind === "instruction" &&
          node.path === "trees/api/feature-auth/AGENTS.md" &&
          node.scope === "api/feature-auth",
      ),
    ).toBe(true);
  });

  it("uses the worktree root loaded scope when only workspace instructions are loaded", async () => {
    await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
    await writeFile(paths.workspaceInstructions("myws"), "# workspace\n");

    const result = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sources.map((source) => source.path)).toEqual([".grove/instructions.md"]);
    expect(result.value.loadedScope).toBe("trees/api/feature-auth");
    expect(result.value.contextKey).toBe("myws/api/feature-auth");
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

  it("resolves an absolute workspace-tree target path through a realpath alias", async () => {
    const realRoot = join(tempDir, "real-workspaces");
    const linkedRoot = join(tempDir, "linked-workspaces");
    await mkdir(realRoot, { recursive: true });
    await symlink(realRoot, linkedRoot, "dir");
    const aliasPaths = createPaths(linkedRoot);
    await addWorkspace("aliasws", aliasPaths);
    await addRepo("aliasws", repoPath, "api", aliasPaths, GIT_ENV);
    const legacyRoot = aliasPaths.worktreeDir("aliasws", "api", "legacy");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, "AGENTS.md"), "# legacy\n");
    const realTarget = join(realRoot, "aliasws", "trees", "api", "legacy", "AGENTS.md");

    const result = await getTargetContext(
      "aliasws",
      realTarget,
      aliasPaths.workspace("aliasws"),
      aliasPaths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.worktreePath).toBe("trees/api/legacy");
    expect(result.value.loadedScope).toBe("trees/api/legacy");
    expect(result.value.sources[0].content).toBe("# legacy\n");
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

  it("changes only workspace source hashes when workspace instructions change", async () => {
    await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
    await writeFile(paths.workspaceInstructions("myws"), "# workspace one\n");
    const featureRoot = paths.worktreeDir("myws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# target\n");

    const first = await getTargetContext(
      "myws",
      "trees/api/feature-auth",
      paths.workspace("myws"),
      paths,
    );
    await writeFile(paths.workspaceInstructions("myws"), "# workspace two\n");
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
    expect(first.value.sources[0].hash).not.toBe(second.value.sources[0].hash);
    expect(first.value.sources[1].hash).toBe(second.value.sources[1].hash);
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

  it("resolves a linked worktree target from the registered repo path", async () => {
    const nested = join(repoPath, "packages", "auth");
    await mkdir(nested, { recursive: true });
    await writeFile(join(repoPath, "AGENTS.md"), "# repo root\n");
    await writeFile(join(nested, "AGENTS.md"), "# auth package\n");

    const result = await getTargetContext("myws", nested, paths.workspace("myws"), paths);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.repo).toBe("api");
    expect(result.value.slug).toBe("main");
    expect(result.value.worktreePath).toBe("trees/api/main");
    expect(result.value.loadedScope).toBe("trees/api/main/packages/auth");
    expect(result.value.sources.map((source) => source.path)).toEqual([
      "trees/api/main/AGENTS.md",
      "trees/api/main/packages/auth/AGENTS.md",
    ]);
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

  describe("touchContext", () => {
    it("serves the full chain on first touch: workspace + worktree root + ancestors", async () => {
      await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
      await writeFile(paths.workspaceInstructions("myws"), "# workspace\n");
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      await mkdir(join(root, "src", "lib"), { recursive: true });
      await writeFile(join(root, "src", "lib", "AGENTS.md"), "# lib\n");
      await writeFile(join(root, "src", "lib", "file.ts"), "export const x = 1;\n");

      const ledger = new ContextLedger("session-1");
      const result = await touchContext(
        "myws",
        ["trees/api/feature-auth/src/lib/file.ts"],
        { cwd: paths.workspace("myws"), trigger: "cli", ledger },
        paths,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.mode).toBe("touch");
      expect(result.value.entries.map((e) => e.status)).toEqual(["served", "served", "served"]);
      expect(result.value.entries.every((e) => e.content)).toBe(true);
    });

    it("returns current markers without content on second touch", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      await mkdir(join(root, "src", "lib"), { recursive: true });
      await writeFile(join(root, "src", "lib", "AGENTS.md"), "# lib\n");
      await writeFile(join(root, "src", "lib", "file.ts"), "export const x = 1;\n");

      const ledger = new ContextLedger("session-1");
      const options = { cwd: paths.workspace("myws"), trigger: "cli" as const, ledger };
      await touchContext("myws", ["trees/api/feature-auth/src/lib/file.ts"], options, paths);
      const second = await touchContext(
        "myws",
        ["trees/api/feature-auth/src/lib/file.ts"],
        options,
        paths,
      );

      expect(second.ok).toBe(true);
      if (!second.ok) {
        return;
      }
      expect(second.value.entries.every((e) => e.status === "current")).toBe(true);
      expect(second.value.entries.every((e) => e.content === undefined)).toBe(true);
    });

    it("re-serves only the changed scope as updated after a file edit", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      await mkdir(join(root, "src", "lib"), { recursive: true });
      await writeFile(join(root, "src", "lib", "AGENTS.md"), "# lib\n");
      await writeFile(join(root, "src", "lib", "file.ts"), "export const x = 1;\n");

      const ledger = new ContextLedger("session-1");
      const options = { cwd: paths.workspace("myws"), trigger: "cli" as const, ledger };
      await touchContext("myws", ["trees/api/feature-auth/src/lib/file.ts"], options, paths);
      await writeFile(join(root, "src", "lib", "AGENTS.md"), "# lib v2\n");
      const third = await touchContext(
        "myws",
        ["trees/api/feature-auth/src/lib/file.ts"],
        options,
        paths,
      );

      expect(third.ok).toBe(true);
      if (!third.ok) {
        return;
      }
      const statuses = Object.fromEntries(third.value.entries.map((e) => [e.sourcePath, e.status]));
      expect(statuses["trees/api/feature-auth/src/lib/AGENTS.md"]).toBe("updated");
      expect(statuses["trees/api/feature-auth/AGENTS.md"]).toBe("current");
    });

    it("dedups shared scopes across a multi-path batch", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      await mkdir(join(root, "src", "a"), { recursive: true });
      await mkdir(join(root, "src", "b"), { recursive: true });
      await writeFile(join(root, "src", "a", "file.ts"), "export const a = 1;\n");
      await writeFile(join(root, "src", "b", "file.ts"), "export const b = 1;\n");

      const ledger = new ContextLedger("session-1");
      const result = await touchContext(
        "myws",
        ["trees/api/feature-auth/src/a/file.ts", "trees/api/feature-auth/src/b/file.ts"],
        { cwd: paths.workspace("myws"), trigger: "cli", ledger },
        paths,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const rootKeys = result.value.entries.filter((e) => e.contextKey === "myws/api/feature-auth");
      expect(rootKeys).toHaveLength(1);
    });

    it("without a ledger (stateless) everything serves every time", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");

      const options = { cwd: paths.workspace("myws"), trigger: "cli" as const };
      const first = await touchContext("myws", ["trees/api/feature-auth"], options, paths);
      const second = await touchContext("myws", ["trees/api/feature-auth"], options, paths);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) {
        return;
      }
      expect(first.value.entries.every((e) => e.status === "served")).toBe(true);
      expect(second.value.entries.every((e) => e.status === "served")).toBe(true);
    });

    it("refresh=true re-serves already-current scopes as refreshed", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");

      const ledger = new ContextLedger("session-1");
      await touchContext(
        "myws",
        ["trees/api/feature-auth"],
        { cwd: paths.workspace("myws"), trigger: "cli", ledger },
        paths,
      );
      const result = await touchContext(
        "myws",
        ["trees/api/feature-auth"],
        { cwd: paths.workspace("myws"), trigger: "cli", ledger, refresh: true },
        paths,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.entries.every((e) => e.status === "refreshed")).toBe(true);
      expect(result.value.entries.every((e) => e.content !== undefined)).toBe(true);
    });

    it("truncates the chain at the deepest non-ignored ancestor for a gitignored path", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      await writeFile(join(root, ".gitignore"), "node_modules/\n");
      await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(root, "node_modules", "pkg", "AGENTS.md"), "# vendored\n");
      await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n");

      const ledger = new ContextLedger("session-1");
      const result = await touchContext(
        "myws",
        ["trees/api/feature-auth/node_modules/pkg/index.js"],
        { cwd: paths.workspace("myws"), trigger: "cli", ledger },
        paths,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const sourcePaths = result.value.entries.map((e) => e.sourcePath);
      expect(sourcePaths).not.toContain("trees/api/feature-auth/node_modules/pkg/AGENTS.md");
      expect(sourcePaths).toContain("trees/api/feature-auth/AGENTS.md");
    });

    it("errors with CONTEXT_TARGET_NOT_FOUND for a path outside any worktree", async () => {
      const outside = join(tempDir, "outside-workspace");
      await mkdir(outside, { recursive: true });

      const result = await touchContext(
        "myws",
        [outside],
        { cwd: paths.workspace("myws"), trigger: "cli" },
        paths,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("CONTEXT_TARGET_NOT_FOUND");
      }
    });

    it("writes journal events for every decision including current", async () => {
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      const journalDir = await createTestDir();

      const ledger = new ContextLedger("session-1");
      const recorder = new DisclosureRecorder(journalDir);
      const options = { cwd: paths.workspace("myws"), trigger: "cli" as const, ledger, recorder };
      await touchContext("myws", ["trees/api/feature-auth"], options, paths);
      await touchContext("myws", ["trees/api/feature-auth"], options, paths);

      const journalText = await readFile(join(journalDir, "journal.jsonl"), "utf-8");
      const lines = journalText.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      const actions = lines.map((line) => JSON.parse(line).action);
      expect(actions).toEqual(["served", "current"]);

      await cleanup(journalDir);
    });

    it("does not poison the session ledger when an earlier touch errors on a bad path", async () => {
      await mkdir(paths.workspaceGroveDir("myws"), { recursive: true });
      await writeFile(paths.workspaceInstructions("myws"), "# workspace\n");
      const root = paths.worktreeDir("myws", "api", "feature-auth");
      await writeFile(join(root, "AGENTS.md"), "# root\n");
      const outside = join(tempDir, "outside-workspace");
      await mkdir(outside, { recursive: true });
      const journalDir = await createTestDir();

      const ledger = new ContextLedger("session-1");
      const recorder = new DisclosureRecorder(journalDir);
      const options = { cwd: paths.workspace("myws"), trigger: "cli" as const, ledger, recorder };

      const errored = await touchContext("myws", [outside], options, paths);
      expect(errored.ok).toBe(false);
      if (errored.ok) {
        return;
      }
      expect(errored.code).toBe("CONTEXT_TARGET_NOT_FOUND");

      // The erroring call must have written NO journal events (nothing was delivered).
      const afterError = await readFile(join(journalDir, "journal.jsonl"), "utf-8").catch(() => "");
      expect(afterError.trim()).toBe("");

      // A subsequent valid touch in the SAME session must still serve everything with
      // content — the erroring call did not record the workspace scope as served.
      const valid = await touchContext("myws", ["trees/api/feature-auth"], options, paths);
      expect(valid.ok).toBe(true);
      if (!valid.ok) {
        return;
      }
      expect(valid.value.entries.every((e) => e.status === "served")).toBe(true);
      expect(valid.value.entries.every((e) => e.content !== undefined)).toBe(true);
      const workspaceEntry = valid.value.entries.find((e) => e.contextKey === "myws/workspace");
      expect(workspaceEntry?.content).toBe("# workspace\n");

      await cleanup(journalDir);
    });
  });
});
