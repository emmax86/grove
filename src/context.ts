import { exists, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Paths } from "./constants";
import { readConfig } from "./lib/config";
import { type Context, err, ok, type Result } from "./types";

async function tryRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * Walk up from cwd looking for workspace.json to infer workspace/repo/worktree context.
 *
 * Uses logical (unresolved) cwd first so pool worktrees accessed via symlinks are
 * correctly resolved back to their workspace. Falls back to the realpath cwd to
 * handle macOS /tmp → /private/tmp aliasing.
 */
export async function inferContext(cwd: string, workspacesRoot: string): Promise<Context> {
  const realRoot = await tryRealpath(workspacesRoot);

  // Step 1: Walk logical cwd (exists follows symlinks, so this works for pool symlinks
  // as well as macOS /tmp aliases)
  let found: string | undefined;
  let effectiveCwd = cwd;

  let dir = cwd;
  while (dir !== dirname(dir)) {
    if (await exists(join(dir, "workspace.json"))) {
      found = dir;
      break;
    }
    dir = dirname(dir);
  }

  // Step 2: Fall back to resolved cwd if logical walk failed (edge case: broken path components)
  if (!found) {
    const resolvedCwd = await tryRealpath(cwd);
    if (resolvedCwd !== cwd) {
      effectiveCwd = resolvedCwd;
      let dir2 = resolvedCwd;
      while (dir2 !== dirname(dir2)) {
        if (await exists(join(dir2, "workspace.json"))) {
          found = dir2;
          break;
        }
        dir2 = dirname(dir2);
      }
    }
  }

  if (!found) {
    return {};
  }

  const workspaceDir = found;
  const workspaceName = workspaceDir.split(sep).pop() ?? "";

  // Step 3-4: Resolve found dir for root-containment check
  const realFound = await tryRealpath(found);
  const rel = relative(realRoot, realFound);
  if (rel.startsWith("..") || rel === "") {
    return {};
  }

  const context: Context = {
    workspace: workspaceName,
    workspacePath: workspaceDir,
  };

  // Step 5: Extract repo/worktree segments.
  // Both effectiveCwd and found are in the same domain (both logical or both resolved),
  // so relative() produces the correct answer.
  const relToCwd = relative(found, effectiveCwd);
  if (!relToCwd) {
    return context;
  }

  const segments = relToCwd.split(sep).filter(Boolean);
  if (segments.length === 0) {
    return context;
  }

  // Repos live under trees/ within the workspace directory
  const offset = segments[0] === "trees" ? 1 : 0;
  const repoSegment = segments[offset];
  if (!repoSegment) {
    return context;
  }

  // Validate repo segment against workspace.json
  const configResult = await readConfig(join(workspaceDir, "workspace.json"));
  if (!configResult.ok) {
    return context;
  }

  const repoEntry = configResult.value.repos.find((r) => r.name === repoSegment);
  if (!repoEntry) {
    return context;
  }

  context.repo = repoSegment;

  if (segments.length >= offset + 2) {
    context.worktree = segments[offset + 1];
  }

  return context;
}

/**
 * Given an absolute file path, determine which registered repo it belongs to
 * and return the repo name and the worktree root directory.
 *
 * Checks pool worktrees first (path under {root}/worktrees/), then falls back
 * to matching against each repo's registered main-worktree path.
 */
export async function resolveRepoFromFile(
  filePath: string,
  workspace: string,
  paths: Paths,
): Promise<Result<{ repo: string; worktreeRoot: string }>> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(filePath);
  } catch {
    return err(`File not found: ${filePath}`, "REPO_NOT_RESOLVED");
  }

  // Read workspace config once — used by both pool-path and main-worktree checks below
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    return err("Workspace not found", "REPO_NOT_RESOLVED");
  }

  // Check if the file is under the shared worktrees pool
  const poolRoot = paths.worktreePool;
  const poolPrefix = poolRoot + sep;
  if (resolvedPath.startsWith(poolPrefix)) {
    const rel = resolvedPath.slice(poolPrefix.length);
    const parts = rel.split(sep);
    if (parts.length >= 2) {
      const repo = parts[0];
      const slug = parts[1];
      if (configResult.value.repos.find((r) => r.name === repo)) {
        return ok({ repo, worktreeRoot: paths.worktreePoolEntry(repo, slug) });
      }
    }
  }

  // Fall back to matching against registered repo main-worktree paths

  for (const repoEntry of configResult.value.repos) {
    let realRepoPath: string;
    try {
      realRepoPath = await realpath(repoEntry.path);
    } catch {
      continue;
    }
    if (resolvedPath === realRepoPath || resolvedPath.startsWith(realRepoPath + sep)) {
      return ok({ repo: repoEntry.name, worktreeRoot: realRepoPath });
    }
  }

  return err(`Cannot determine repo for file: ${filePath}`, "REPO_NOT_RESOLVED");
}
