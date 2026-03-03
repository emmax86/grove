import { exists, lstat, readdir, readlink, realpath, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { Paths } from "../constants";
import { err, ok, type Result } from "../types";
import { readPoolConfig, writePoolConfig } from "./config";
import { type GitEnv, removeWorktree as gitRemoveWorktree } from "./git";

/**
 * Classify a worktree entry path.
 * - "pool"   — symlink into the shared worktree pool
 * - "linked" — default-branch symlink, unreadable symlink, or other non-pool symlink
 * - "legacy" — real directory (old-style git worktree at workspace path)
 * - null     — entry doesn't exist or is not a symlink/directory (caller should skip)
 */
export async function classifyWorktreeEntry(
  wtPath: string,
  paths: Paths,
): Promise<"pool" | "linked" | "legacy" | null> {
  let lstatResult: Awaited<ReturnType<typeof lstat>>;
  try {
    lstatResult = await lstat(wtPath);
  } catch {
    return null;
  }

  if (lstatResult.isSymbolicLink()) {
    let target: string;
    try {
      target = await readlink(wtPath);
    } catch {
      return "linked"; // unreadable symlink — treat as linked (safe fallback)
    }
    const absoluteTarget = resolve(dirname(wtPath), target);
    const relToPool = relative(paths.worktreePool, absoluteTarget);
    return relToPool.startsWith("..") ? "linked" : "pool";
  }

  if (lstatResult.isDirectory()) {
    return "legacy";
  }

  return null;
}

/**
 * Resolve the real filesystem path of a repo through the repos/ symlink.
 */
export async function resolveRepoPath(repoName: string, paths: Paths): Promise<Result<string>> {
  const treePath = paths.repoEntry(repoName);
  try {
    return ok(await realpath(treePath));
  } catch {
    return err(`Repo "${repoName}" has a dangling symlink`, "DANGLING_SYMLINK");
  }
}

/**
 * Remove a pool worktree and all associated state in the correct order:
 * 1. Workspace tree symlink (unless skipSymlink)
 * 2. worktrees.json reference (always reached)
 * 3. Pool directory via git worktree remove (if last ref; soft-fails as gitWarning)
 */
export async function removePoolWorktree(
  workspace: string,
  repo: string,
  slug: string,
  options: { force?: boolean; skipSymlink?: boolean },
  paths: Paths,
  env?: GitEnv,
): Promise<Result<{ gitWarning?: string }>> {
  // Step 1: remove workspace tree symlink first (most detectable/repairable if skipped)
  if (!options.skipSymlink) {
    const wtPath = paths.worktreeDir(workspace, repo, slug);
    try {
      await rm(wtPath);
    } catch {
      /* best-effort */
    }
  }

  // Step 2: read-modify-write worktrees.json in a single pass
  const poolConfig = paths.worktreePoolConfig;
  const poolResult = await readPoolConfig(poolConfig);
  if (!poolResult.ok) {
    return poolResult;
  }

  const pool = poolResult.value;
  // wasLastRef is only true when workspace was recorded as the last reference.
  // When the entry is absent we cannot confirm no other workspace references the pool dir,
  // so we conservatively skip pool directory removal.
  let wasLastRef = false;

  if (pool[repo]?.[slug]) {
    const list = pool[repo][slug];
    const idx = list.indexOf(workspace);
    if (idx !== -1) {
      list.splice(idx, 1);
      if (list.length === 0) {
        wasLastRef = true;
        delete pool[repo][slug];
        if (Object.keys(pool[repo]).length === 0) {
          delete pool[repo];
        }
      }
      const writeResult = await writePoolConfig(poolConfig, pool);
      if (!writeResult.ok) {
        return writeResult;
      }
    }
  }

  // Step 3: if this was the last recorded reference, remove pool directory
  if (wasLastRef) {
    const poolEntryPath = paths.worktreePoolEntry(repo, slug);
    const poolRepoDir = paths.worktreePoolRepo(repo);
    let gitWarning: string | undefined;

    const repoPathResult = await resolveRepoPath(repo, paths);
    if (!repoPathResult.ok) {
      // Dangling repo symlink — remove pool dir directly
      try {
        await rm(poolEntryPath, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    } else if (!(await exists(poolEntryPath))) {
      // Pool dir already gone — skip git call
    } else {
      const gitResult = await gitRemoveWorktree(
        repoPathResult.value,
        poolEntryPath,
        options.force,
        env,
      );
      if (!gitResult.ok) {
        gitWarning = gitResult.error;
      }
    }

    // Best-effort: clean up empty worktrees/{repo}/ parent directory
    try {
      const entries = await readdir(poolRepoDir);
      if (entries.length === 0) {
        await rm(poolRepoDir, { recursive: true, force: true });
      }
    } catch {
      /* best-effort */
    }

    return ok({ gitWarning });
  }

  return ok({});
}
