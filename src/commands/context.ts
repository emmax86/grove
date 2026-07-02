import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Paths } from "../constants";
import { readWorkspaceConfig } from "../lib/config";
import type { ContextLedger } from "../lib/context-ledger";
import type { DisclosureRecorder, TouchStatus } from "../lib/context-state";
import { isPathIgnored, listInstructionFiles } from "../lib/git";
import { err, ok, type Result, type WorktreeEntry } from "../types";
import { getStatus } from "./status";

export type InstructionFileName = "AGENTS.override.md" | "AGENTS.md" | "CLAUDE.md";
export type ContextInstructionLayer = "workspace" | "target";
// "generated" is reserved for future Grove-authored instruction files.
export type ContextInstructionOwnership = "user" | "generated";
export type ContextInstructionKind = "workspace" | InstructionFileName;

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
  kind: ContextInstructionKind;
  layer: ContextInstructionLayer;
  ownership: ContextInstructionOwnership;
  selectionReason: string;
  contentHash: string;
  contextKey: string;
  loadCommand: string;
  /** Compatibility alias for contentHash; keep this stable for existing JSON and porcelain consumers. */
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
  workspaceInstructions?: ContextInstructionSource;
  index: ContextIndexEntry[];
  graph: ContextGraph;
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
  graph: ContextGraph;
  skipped: ContextSkippedEntry[];
}

export interface TouchEntry {
  contextKey: string;
  scopePath: string;
  sourcePath: string;
  contentHash: string;
  status: TouchStatus;
  /** Present for served/updated/refreshed; absent for current. */
  content?: string;
}

export interface TouchContext {
  mode: "touch";
  workspace: ContextWorkspaceInfo;
  session: string;
  entries: TouchEntry[];
  skipped: ContextSkippedEntry[];
}

export interface TouchOptions {
  cwd: string;
  refresh?: boolean;
  /** Absent = stateless (everything serves). */
  ledger?: ContextLedger;
  recorder?: DisclosureRecorder;
  trigger: "mcp" | "cli";
}

export type GroveContext = WorkspaceContext | TargetContext | TouchContext;

export interface ContextGraphNode {
  id: string;
  kind: "workspace" | "target" | "instruction" | "context";
  path?: string;
  scope?: string;
  layer?: ContextInstructionLayer;
  ownership?: ContextInstructionOwnership;
  selectionReason: string;
  contentHash?: string;
}

export interface ContextGraph {
  root: string;
  nodes: ContextGraphNode[];
}

const INSTRUCTION_FILES: InstructionFileName[] = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"];
const IGNORED_INDEX_DIRS = new Set([".git", ".worktrees", "node_modules"]);

function toWorkspaceRelative(path: string, workspaceRoot: string): string {
  return relative(workspaceRoot, path).split(sep).join("/");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function hashNode(parts: unknown): string {
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

interface BuildInstructionEntryArgs {
  workspace: string;
  repo: string;
  slug: string;
  scope: string;
  scopePath: string;
  sourcePath: string;
  kind: ContextInstructionKind;
  layer: ContextInstructionLayer;
  ownership: ContextInstructionOwnership;
  selectionReason: string;
  content: string;
  loadCommand: string;
}

function buildInstructionEntry(args: BuildInstructionEntryArgs): ContextIndexEntry {
  const contentHash = hashContent(args.content);

  return {
    repo: args.repo,
    slug: args.slug,
    scope: args.scope,
    scopePath: args.scopePath,
    sourcePath: args.sourcePath,
    kind: args.kind,
    layer: args.layer,
    ownership: args.ownership,
    selectionReason: args.selectionReason,
    contentHash,
    contextKey: `${args.workspace}/${args.scope}`,
    loadCommand: args.loadCommand,
    hash: contentHash,
  };
}

function buildInstructionSource(
  args: BuildInstructionEntryArgs & { path?: string },
): ContextInstructionSource {
  return {
    ...buildInstructionEntry(args),
    path: args.path ?? args.sourcePath,
    content: args.content,
  };
}

function sourceToGraphNode(source: ContextIndexEntry): ContextGraphNode {
  return {
    id: `instruction:${source.sourcePath}`,
    kind: "instruction",
    path: source.sourcePath,
    scope: source.scope,
    layer: source.layer,
    ownership: source.ownership,
    selectionReason: source.selectionReason,
    contentHash: source.contentHash,
  };
}

function contextHashSource(source: ContextIndexEntry): unknown {
  return {
    repo: source.repo,
    slug: source.slug,
    scope: source.scope,
    scopePath: source.scopePath,
    sourcePath: source.sourcePath,
    kind: source.kind,
    layer: source.layer,
    ownership: source.ownership,
    selectionReason: source.selectionReason,
    contentHash: source.contentHash,
  };
}

function buildContextGraph(args: {
  workspace: ContextWorkspaceInfo;
  target?: { repo: string; slug: string; loadedScope: string; worktreePath: string };
  sources: ContextIndexEntry[];
}): ContextGraph {
  const sourceNodes = args.sources.map(sourceToGraphNode);
  const workspaceNode: ContextGraphNode = {
    id: `workspace:${args.workspace.name}`,
    kind: "workspace",
    path: args.workspace.path,
    selectionReason: "active workspace",
  };

  const nodes: ContextGraphNode[] = [workspaceNode, ...sourceNodes];

  if (args.target) {
    nodes.push({
      id: `target:${args.target.repo}/${args.target.slug}:${args.target.loadedScope}`,
      kind: "target",
      scope: args.target.loadedScope,
      selectionReason: "resolved context target",
    });
  }

  const root = hashNode({
    kind: "context",
    workspace: args.workspace.name,
    target: args.target ?? null,
    sources: args.sources.map(contextHashSource),
  });
  nodes.push({
    id: args.target
      ? `context:${args.workspace.name}/${args.target.loadedScope}`
      : `context:${args.workspace.name}`,
    kind: "context",
    scope: args.target?.loadedScope ?? args.workspace.name,
    selectionReason: "effective context root",
  });

  return { root, nodes };
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
      index.push(
        buildInstructionEntry({
          workspace,
          repo,
          slug,
          scope,
          scopePath,
          sourcePath,
          kind: file,
          layer: "target",
          ownership: "user",
          selectionReason: "selected by worktree instruction priority",
          content,
          loadCommand: `grove ws context ${workspace} ${scopePath}`,
        }),
      );
      return;
    } catch (e) {
      skipped.push({ path: sourcePath, reason: String(e) });
      return;
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
      return buildInstructionSource({
        workspace,
        repo,
        slug,
        scope,
        scopePath,
        sourcePath,
        path: sourcePath,
        kind: file,
        layer: "target",
        ownership: "user",
        selectionReason: "selected by worktree instruction priority",
        content,
        loadCommand: `grove ws context ${workspace} ${scopePath}`,
      });
    } catch (e) {
      skipped.push({ path: sourcePath, reason: String(e) });
      return null;
    }
  }

  return null;
}

async function readWorkspaceInstructionSource(
  workspace: string,
  paths: Paths,
  skipped: ContextSkippedEntry[],
): Promise<ContextInstructionSource | null> {
  const workspaceRoot = paths.workspace(workspace);
  const source = paths.workspaceInstructions(workspace);
  const sourcePath = toWorkspaceRelative(source, workspaceRoot);

  try {
    await lstat(source);
  } catch (e) {
    if (!isNotFoundError(e)) {
      skipped.push({ path: sourcePath, reason: String(e) });
    }
    return null;
  }

  try {
    const content = await readFile(source, "utf-8");
    return buildInstructionSource({
      workspace,
      repo: "",
      slug: "",
      scope: "workspace",
      scopePath: ".grove",
      sourcePath,
      path: sourcePath,
      kind: "workspace",
      layer: "workspace",
      ownership: "user",
      selectionReason: "workspace instruction file",
      content,
      loadCommand: `grove ws context ${workspace}`,
    });
  } catch (e) {
    skipped.push({ path: sourcePath, reason: String(e) });
    return null;
  }
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

/**
 * Index instruction scopes via git enumeration (tracked + untracked-but-not-ignored
 * files). Returns false when git enumeration fails so the caller can fall back to
 * the directory walk (e.g. the worktree directory is not a git repo).
 */
async function indexInstructionScopesGit(
  workspace: string,
  workspaceRoot: string,
  repo: string,
  slug: string,
  worktreeRoot: string,
  index: ContextIndexEntry[],
  skipped: ContextSkippedEntry[],
): Promise<boolean> {
  const filesResult = await listInstructionFiles(worktreeRoot);
  if (!filesResult.ok) {
    skipped.push({
      path: toWorkspaceRelative(worktreeRoot, workspaceRoot),
      reason: `git enumeration failed, fell back to directory walk: ${filesResult.error}`,
    });
    return false;
  }

  // Instruction priority is per-directory: group files by dirname, then let the
  // existing selector (addInstructionEntry) apply AGENTS.override.md > AGENTS.md > CLAUDE.md.
  const dirs = new Set<string>(
    filesResult.value.map((rel) => {
      const idx = rel.lastIndexOf("/");
      return idx === -1 ? worktreeRoot : join(worktreeRoot, rel.slice(0, idx));
    }),
  );
  for (const dir of [...dirs].sort()) {
    await addInstructionEntry(workspace, workspaceRoot, repo, slug, dir, index, skipped);
  }
  return true;
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
    if (IGNORED_INDEX_DIRS.has(entry)) {
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
      // Do not recurse through directory symlinks from workspace indexing: targets may escape the
      // worktree. Record the skipped path so the omission is visible in rendered context.
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
  const workspaceInstructions = await readWorkspaceInstructionSource(workspace, paths, skipped);

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
      const usedGit = await indexInstructionScopesGit(
        workspace,
        workspaceRoot,
        worktree.repo,
        worktree.slug,
        worktreePath,
        index,
        skipped,
      );
      if (!usedGit) {
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
  const workspaceInfo = {
    name: statusResult.value.name,
    path: statusResult.value.path,
  };
  const graphSources = workspaceInstructions ? [workspaceInstructions, ...index] : index;
  const graph = buildContextGraph({
    workspace: workspaceInfo,
    sources: graphSources,
  });

  return ok({
    mode: "workspace",
    workspace: workspaceInfo,
    worktrees,
    ...(workspaceInstructions ? { workspaceInstructions } : {}),
    index,
    graph,
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
  const workspaceInstructions = await readWorkspaceInstructionSource(workspace, paths, skipped);
  if (workspaceInstructions) {
    sources.push(workspaceInstructions);
  }

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

  const targetSources = sources.filter((source) => source.layer === "target");
  const loadedScope =
    targetSources.length > 0
      ? targetSources[targetSources.length - 1].scopePath
      : resolved.worktreePath;
  const contextKey = contextKeyForScope(workspace, loadedScope);
  const workspaceInfo = {
    name: statusResult.value.name,
    path: statusResult.value.path,
  };
  const graph = buildContextGraph({
    workspace: workspaceInfo,
    target: {
      repo: resolved.repo,
      slug: resolved.slug,
      loadedScope,
      worktreePath: resolved.worktreePath,
    },
    sources,
  });

  return ok({
    mode: "target",
    workspace: workspaceInfo,
    target,
    repo: resolved.repo,
    slug: resolved.slug,
    worktreePath: resolved.worktreePath,
    loadedScope,
    contextKey,
    contextHash: graph.root,
    sources,
    graph,
    skipped,
  });
}

export async function touchContext(
  workspace: string,
  targetPaths: string[],
  options: TouchOptions,
  paths: Paths,
): Promise<Result<TouchContext>> {
  const statusResult = await getStatus(workspace, paths);
  if (!statusResult.ok) {
    return statusResult;
  }
  const workspaceRoot = paths.workspace(workspace);
  const skipped: ContextSkippedEntry[] = [];
  const entries: TouchEntry[] = [];
  const seenKeys = new Set<string>();
  const session = options.ledger?.sessionKey ?? "stateless";

  const classifyAndPush = async (source: ContextInstructionSource) => {
    if (seenKeys.has(source.contextKey)) {
      return; // batch dedup: one decision per scope per call
    }
    seenKeys.add(source.contextKey);
    const status: TouchStatus = options.ledger
      ? options.ledger.classify(source.contextKey, source.contentHash, options.refresh ?? false)
      : "served";
    const withContent = status !== "current";
    entries.push({
      contextKey: source.contextKey,
      scopePath: source.scopePath,
      sourcePath: source.sourcePath,
      contentHash: source.contentHash,
      status,
      ...(withContent ? { content: source.content } : {}),
    });
    if (withContent) {
      options.ledger?.record(source.contextKey, source.contentHash);
    }
    await options.recorder?.record(
      {
        ts: new Date().toISOString(),
        session,
        trigger: options.trigger,
        contextKey: source.contextKey,
        contentHash: source.contentHash,
        action: status,
      },
      withContent ? source.content : undefined,
    );
  };

  const workspaceSource = await readWorkspaceInstructionSource(workspace, paths, skipped);
  if (workspaceSource) {
    await classifyAndPush(workspaceSource);
  }

  for (const target of targetPaths) {
    const resolvedTargetPath = resolveTargetPath(target, options.cwd);
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
    let targetDir = targetStats.isDirectory() ? resolved.targetPath : dirname(resolved.targetPath);

    // Gitignored touch path (e.g. inside node_modules): truncate the chain to
    // the deepest non-ignored ancestor so vendored instruction files never serve.
    while (
      targetDir !== resolved.worktreeRoot &&
      (await isPathIgnored(targetDir, resolved.worktreeRoot))
    ) {
      targetDir = dirname(targetDir);
    }

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
        await classifyAndPush(source);
      }
    }
  }

  return ok({
    mode: "touch",
    workspace: { name: statusResult.value.name, path: statusResult.value.path },
    session,
    entries,
    skipped,
  });
}
