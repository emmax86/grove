import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Paths } from "../constants";
import { readWorkspaceConfig } from "../lib/config";
import { err, ok, type Result, type WorktreeEntry } from "../types";
import { getStatus } from "./status";

export type InstructionFileName = "AGENTS.override.md" | "AGENTS.md" | "CLAUDE.md";

export interface ContextWorkspaceInfo {
  name: string;
  path: string;
}

export interface ContextWorktreeInfo {
  repo: string;
  slug: string;
  branch: string;
  type: WorktreeEntry["type"];
  path: string;
}

export interface ContextIndexEntry {
  repo: string;
  slug: string;
  scope: string;
  scopePath: string;
  sourcePath: string;
  kind: InstructionFileName;
  contextKey: string;
  loadCommand: string;
  hash: string;
}

export interface ContextSkippedEntry {
  path: string;
  reason: string;
}

export interface WorkspaceContext {
  mode: "workspace";
  workspace: ContextWorkspaceInfo;
  worktrees: ContextWorktreeInfo[];
  index: ContextIndexEntry[];
  skipped: ContextSkippedEntry[];
}

export interface ContextInstructionSource extends ContextIndexEntry {
  path: string;
  content: string;
}

export interface TargetContext {
  mode: "target";
  workspace: ContextWorkspaceInfo;
  target: string;
  repo: string;
  slug: string;
  worktreePath: string;
  loadedScope: string;
  contextKey: string;
  contextHash: string;
  sources: ContextInstructionSource[];
  skipped: ContextSkippedEntry[];
}

export type GroveContext = WorkspaceContext | TargetContext;

const INSTRUCTION_FILES: InstructionFileName[] = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"];

function toWorkspaceRelative(path: string, workspaceRoot: string): string {
  return relative(workspaceRoot, path).split(sep).join("/");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function hashContext(parts: unknown[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

async function tryRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveTargetPath(target: string, cwd: string): string {
  return isAbsolute(target) ? resolve(target) : resolve(cwd, target);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code: unknown }).code === "ENOENT" ||
      (error as { code: unknown }).code === "ENOTDIR")
  );
}

function hasSkippedPath(skipped: ContextSkippedEntry[], path: string): boolean {
  return skipped.some((entry) => entry.path === path);
}

async function addInstructionEntry(
  workspace: string,
  workspaceRoot: string,
  repo: string,
  slug: string,
  dir: string,
  index: ContextIndexEntry[],
  skipped: ContextSkippedEntry[],
): Promise<void> {
  const scopePath = toWorkspaceRelative(dir, workspaceRoot);
  const scope = scopePath.replace(/^trees\//, "");

  for (const file of INSTRUCTION_FILES) {
    const source = join(dir, file);
    const sourcePath = toWorkspaceRelative(source, workspaceRoot);
    try {
      await lstat(source);
    } catch (e) {
      if (!isNotFoundError(e)) {
        skipped.push({ path: sourcePath, reason: String(e) });
      }
      continue;
    }

    try {
      const content = await readFile(source, "utf-8");
      index.push({
        repo,
        slug,
        scope,
        scopePath,
        sourcePath,
        kind: file,
        contextKey: `${workspace}/${scope}`,
        loadCommand: `grove ws context ${scopePath}`,
        hash: hashContent(content),
      });
      return;
    } catch (e) {
      skipped.push({ path: sourcePath, reason: String(e) });
    }
  }
}

async function readInstructionSource(
  workspace: string,
  workspaceRoot: string,
  repo: string,
  slug: string,
  dir: string,
  skipped: ContextSkippedEntry[],
): Promise<ContextInstructionSource | null> {
  const scopePath = toWorkspaceRelative(dir, workspaceRoot);
  const scope = scopePath.replace(/^trees\//, "");

  for (const file of INSTRUCTION_FILES) {
    const source = join(dir, file);
    const sourcePath = toWorkspaceRelative(source, workspaceRoot);
    try {
      await lstat(source);
    } catch (e) {
      if (!isNotFoundError(e)) {
        skipped.push({ path: sourcePath, reason: String(e) });
      }
      continue;
    }

    try {
      const content = await readFile(source, "utf-8");
      const hash = hashContent(content);
      return {
        repo,
        slug,
        scope,
        scopePath,
        sourcePath,
        path: sourcePath,
        kind: file,
        contextKey: `${workspace}/${scope}`,
        loadCommand: `grove ws context ${scopePath}`,
        hash,
        content,
      };
    } catch (e) {
      skipped.push({ path: sourcePath, reason: String(e) });
    }
  }

  return null;
}

function ancestorDirs(worktreeRoot: string, targetDir: string): string[] {
  const rel = relative(worktreeRoot, targetDir);
  if (!rel) {
    return [worktreeRoot];
  }

  const dirs = [worktreeRoot];
  let current = worktreeRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    dirs.push(current);
  }
  return dirs;
}

function contextKeyForScope(workspace: string, loadedScope: string): string {
  return `${workspace}/${loadedScope.replace(/^trees\//, "")}`;
}

interface ResolvedTarget {
  repo: string;
  slug: string;
  targetPath: string;
  worktreeRoot: string;
  worktreePath: string;
}

function relativeToCandidateRoot(
  candidateRoot: string,
  realCandidateRoot: string,
  targetPath: string,
  realTargetPath: string,
): string | null {
  if (isInsideOrEqual(realCandidateRoot, realTargetPath)) {
    return relative(realCandidateRoot, realTargetPath);
  }
  if (isInsideOrEqual(candidateRoot, targetPath)) {
    return relative(candidateRoot, targetPath);
  }
  return null;
}

function repoContainerError(repo: string, slugs: string[]): Result<never> {
  const available = slugs.length > 0 ? slugs.join(", ") : "none";
  return err(
    `Target "trees/${repo}" is a repo container. Available worktrees: ${available}`,
    "CONTEXT_TARGET_AMBIGUOUS",
  );
}

async function resolveLogicalTarget(
  targetPath: string,
  workspace: string,
  paths: Paths,
  repos: { name: string; path: string; worktrees: WorktreeEntry[] }[],
): Promise<Result<ResolvedTarget>> {
  const workspaceRoot = paths.workspace(workspace);
  const realTargetPath = await tryRealpath(targetPath);

  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      const candidates = [paths.worktreePoolEntry(worktree.repo, worktree.slug)];
      if (worktree.type === "linked") {
        candidates.push(repo.path);
      }

      const worktreeRoot = paths.worktreeDir(workspace, worktree.repo, worktree.slug);
      for (const candidateRoot of candidates) {
        const realCandidateRoot = await tryRealpath(candidateRoot);
        const relToCandidate = relativeToCandidateRoot(
          candidateRoot,
          realCandidateRoot,
          targetPath,
          realTargetPath,
        );
        if (relToCandidate === null) {
          continue;
        }

        return ok({
          repo: worktree.repo,
          slug: worktree.slug,
          targetPath: join(worktreeRoot, relToCandidate),
          worktreeRoot,
          worktreePath: toWorkspaceRelative(worktreeRoot, workspaceRoot),
        });
      }
    }
  }

  const realWorkspaceRoot = await tryRealpath(workspaceRoot);
  const relToWorkspace = relativeToCandidateRoot(
    workspaceRoot,
    realWorkspaceRoot,
    targetPath,
    realTargetPath,
  );
  if (relToWorkspace === null) {
    return err(`Target is not inside workspace trees: ${targetPath}`, "CONTEXT_TARGET_NOT_FOUND");
  }

  const parts = relToWorkspace.split(sep).filter(Boolean);
  if (parts[0] !== "trees") {
    return err(`Target is not inside workspace trees: ${targetPath}`, "CONTEXT_TARGET_NOT_FOUND");
  }

  const repoName = parts[1];
  if (!repoName) {
    return err(
      `Target is not inside a repo tree: ${targetPath}. Use "trees/<repo>/<worktree>" for a workspace-relative target, or "./trees" for a worktree subdirectory named "trees".`,
      "CONTEXT_TARGET_NOT_FOUND",
    );
  }

  const repo = repos.find((entry) => entry.name === repoName);
  if (!repo) {
    return err(`Repo not found in workspace "${workspace}": ${repoName}`, "REPO_NOT_FOUND");
  }

  if (parts.length === 2) {
    return repoContainerError(
      repoName,
      repo.worktrees.map((worktree) => worktree.slug),
    );
  }

  const slug = parts[2];
  const worktree = repo.worktrees.find((entry) => entry.slug === slug);
  if (!worktree) {
    return err(`Worktree not found in repo "${repoName}": ${slug}`, "WORKTREE_NOT_FOUND");
  }

  const worktreeRoot = paths.worktreeDir(workspace, repoName, slug);
  return ok({
    repo: repoName,
    slug,
    targetPath: join(worktreeRoot, ...parts.slice(3)),
    worktreeRoot,
    worktreePath: toWorkspaceRelative(worktreeRoot, workspaceRoot),
  });
}

async function indexInstructionScopes(
  workspace: string,
  workspaceRoot: string,
  repo: string,
  slug: string,
  dir: string,
  index: ContextIndexEntry[],
  skipped: ContextSkippedEntry[],
): Promise<void> {
  const scopePath = toWorkspaceRelative(dir, workspaceRoot);

  await addInstructionEntry(workspace, workspaceRoot, repo, slug, dir, index, skipped);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    skipped.push({ path: scopePath, reason: String(e) });
    return;
  }

  for (const entry of entries) {
    if (entry === ".git" || entry === "node_modules") {
      continue;
    }

    const child = join(dir, entry);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(child);
    } catch (e) {
      skipped.push({ path: toWorkspaceRelative(child, workspaceRoot), reason: String(e) });
      continue;
    }

    if (stats.isDirectory()) {
      await indexInstructionScopes(workspace, workspaceRoot, repo, slug, child, index, skipped);
    } else if (stats.isSymbolicLink()) {
      try {
        const targetStats = await stat(child);
        if (targetStats.isDirectory()) {
          skipped.push({
            path: toWorkspaceRelative(child, workspaceRoot),
            reason: "Symlinked directory not indexed",
          });
        }
      } catch (e) {
        skipped.push({ path: toWorkspaceRelative(child, workspaceRoot), reason: String(e) });
      }
    }
  }
}

async function recordSkippedTreeEntries(
  repos: { name: string }[],
  workspace: string,
  paths: Paths,
  workspaceRoot: string,
  knownWorktrees: Set<string>,
  skipped: ContextSkippedEntry[],
): Promise<void> {
  for (const repo of repos) {
    const repoTreeDir = paths.repoDir(workspace, repo.name);
    const repoTreePath = toWorkspaceRelative(repoTreeDir, workspaceRoot);
    let entries: string[];
    try {
      entries = await readdir(repoTreeDir);
    } catch (e) {
      if (!isNotFoundError(e) && !hasSkippedPath(skipped, repoTreePath)) {
        skipped.push({ path: repoTreePath, reason: String(e) });
      }
      continue;
    }

    for (const slug of entries) {
      const key = `${repo.name}/${slug}`;
      if (knownWorktrees.has(key)) {
        continue;
      }

      const worktreePath = paths.worktreeDir(workspace, repo.name, slug);
      const relativePath = toWorkspaceRelative(worktreePath, workspaceRoot);
      try {
        await lstat(worktreePath);
        if (!hasSkippedPath(skipped, relativePath)) {
          skipped.push({
            path: relativePath,
            reason: "Not a readable worktree directory or symlink",
          });
        }
      } catch (e) {
        if (!hasSkippedPath(skipped, relativePath)) {
          skipped.push({ path: relativePath, reason: String(e) });
        }
      }
    }
  }
}

export async function getWorkspaceContext(
  workspace: string,
  paths: Paths,
): Promise<Result<WorkspaceContext>> {
  const configResult = await readWorkspaceConfig(workspace, paths);
  if (!configResult.ok) {
    return configResult;
  }

  const statusResult = await getStatus(workspace, paths);
  if (!statusResult.ok) {
    return statusResult;
  }

  const workspaceRoot = paths.workspace(workspace);
  const worktrees: ContextWorktreeInfo[] = [];
  const index: ContextIndexEntry[] = [];
  const skipped: ContextSkippedEntry[] = [];
  const knownWorktrees = new Set<string>();

  for (const repo of statusResult.value.repos) {
    for (const worktree of repo.worktrees) {
      knownWorktrees.add(`${worktree.repo}/${worktree.slug}`);
      const worktreePath = paths.worktreeDir(workspace, worktree.repo, worktree.slug);
      const relativePath = toWorkspaceRelative(worktreePath, workspaceRoot);
      worktrees.push({
        repo: worktree.repo,
        slug: worktree.slug,
        branch: worktree.branch,
        type: worktree.type,
        path: relativePath,
      });
      await indexInstructionScopes(
        workspace,
        workspaceRoot,
        worktree.repo,
        worktree.slug,
        worktreePath,
        index,
        skipped,
      );
    }
  }

  await recordSkippedTreeEntries(
    configResult.value.repos,
    workspace,
    paths,
    workspaceRoot,
    knownWorktrees,
    skipped,
  );

  index.sort((a, b) => a.scope.localeCompare(b.scope));

  return ok({
    mode: "workspace",
    workspace: {
      name: statusResult.value.name,
      path: statusResult.value.path,
    },
    worktrees,
    index,
    skipped,
  });
}

export async function getTargetContext(
  workspace: string,
  target: string,
  cwd: string,
  paths: Paths,
): Promise<Result<TargetContext>> {
  const configResult = await readWorkspaceConfig(workspace, paths);
  if (!configResult.ok) {
    return configResult;
  }

  const statusResult = await getStatus(workspace, paths);
  if (!statusResult.ok) {
    return statusResult;
  }

  const workspaceRoot = paths.workspace(workspace);
  const resolvedTargetPath = resolveTargetPath(target, cwd);
  const targetResult = await resolveLogicalTarget(
    resolvedTargetPath,
    workspace,
    paths,
    statusResult.value.repos,
  );
  if (!targetResult.ok) {
    return targetResult;
  }

  const resolved = targetResult.value;
  let targetStats: Awaited<ReturnType<typeof stat>>;
  try {
    targetStats = await stat(resolved.targetPath);
  } catch {
    return err(`Context target not found: ${target}`, "CONTEXT_TARGET_NOT_FOUND");
  }

  const targetDir = targetStats.isDirectory() ? resolved.targetPath : dirname(resolved.targetPath);
  const realWorktreeRoot = await tryRealpath(resolved.worktreeRoot);
  const realTargetDir = await tryRealpath(targetDir);
  if (!isInsideOrEqual(realWorktreeRoot, realTargetDir)) {
    return err(
      `Target is not inside worktree "${resolved.repo}/${resolved.slug}"`,
      "CONTEXT_TARGET_NOT_FOUND",
    );
  }

  const skipped: ContextSkippedEntry[] = [];
  const sources: ContextInstructionSource[] = [];
  for (const dir of ancestorDirs(resolved.worktreeRoot, targetDir)) {
    const source = await readInstructionSource(
      workspace,
      workspaceRoot,
      resolved.repo,
      resolved.slug,
      dir,
      skipped,
    );
    if (source) {
      sources.push(source);
    }
  }

  const loadedScope =
    sources.length > 0 ? sources[sources.length - 1].scopePath : resolved.worktreePath;
  const contextKey = contextKeyForScope(workspace, loadedScope);
  const contextHash = hashContext([
    { name: statusResult.value.name, path: statusResult.value.path },
    resolved.repo,
    resolved.slug,
    loadedScope,
    sources.map((source) => ({ path: source.path, hash: source.hash })),
  ]);

  return ok({
    mode: "target",
    workspace: {
      name: statusResult.value.name,
      path: statusResult.value.path,
    },
    target,
    repo: resolved.repo,
    slug: resolved.slug,
    worktreePath: resolved.worktreePath,
    loadedScope,
    contextKey,
    contextHash,
    sources,
    skipped,
  });
}
