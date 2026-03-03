import { exists, lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { dirname, relative } from "node:path";

import type { Paths } from "../constants";
import { loadCommandConfig, resolveCommand, spawnCommand } from "../lib/commands";
import { addPoolReference, getPoolSlugsForWorkspace, readConfig } from "../lib/config";
import { detectEcosystem } from "../lib/detect";
import {
  type AddWorktreeOptions,
  type GitEnv,
  getDefaultBranch,
  addWorktree as gitAddWorktree,
  removeWorktree as gitRemoveWorktree,
} from "../lib/git";
import { toSlug } from "../lib/slug";
import { classifyWorktreeEntry, removePoolWorktree, resolveRepoPath } from "../lib/worktree-utils";
import { type CommandResult, err, ok, type Result, type WorktreeEntry } from "../types";

export type { AddWorktreeOptions };

export interface AddWorktreeResult extends WorktreeEntry {
  setupResult?: CommandResult;
  setupSkipped?: boolean;
}

export async function addWorktree(
  workspace: string,
  repo: string,
  branch: string,
  options: AddWorktreeOptions & { noSetup?: boolean },
  paths: Paths,
  env?: GitEnv,
): Promise<Result<AddWorktreeResult>> {
  // Validate repo is registered
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    if (configResult.code === "CONFIG_NOT_FOUND") {
      return err(`Workspace "${workspace}" not found`, "WORKSPACE_NOT_FOUND");
    }
    return configResult;
  }

  const repoEntry = configResult.value.repos.find((r) => r.name === repo);
  if (!repoEntry) {
    return err(`Repo "${repo}" is not registered in workspace "${workspace}"`, "REPO_NOT_FOUND");
  }

  // Resolve real repo path through repos/
  const repoPathResult = await resolveRepoPath(repo, paths);
  if (!repoPathResult.ok) {
    return repoPathResult;
  }
  const realRepoPath = repoPathResult.value;

  const slug = toSlug(branch);
  const wtPath = paths.worktreeDir(workspace, repo, slug);

  // Check for slug collision at workspace level
  if ((await classifyWorktreeEntry(wtPath, paths)) !== null) {
    return err(
      `Target directory already exists: "${wtPath}". Branch slug "${slug}" collides with an existing entry.`,
      "SLUG_COLLISION",
    );
  }

  const poolEntryPath = paths.worktreePoolEntry(repo, slug);
  let poolEntryCreated = false;

  // Check if pool entry exists
  if ((await classifyWorktreeEntry(poolEntryPath, paths)) !== null) {
    // Already exists — reuse (flags silently ignored)
    poolEntryCreated = false;
  } else {
    // Create pool entry via git worktree add
    await mkdir(paths.worktreePoolRepo(repo), { recursive: true });
    const gitResult = await gitAddWorktree(
      realRepoPath,
      poolEntryPath,
      branch,
      { newBranch: options.newBranch, from: options.from },
      env,
    );
    if (!gitResult.ok) {
      return gitResult;
    }
    poolEntryCreated = true;
  }

  // Create workspace symlink → worktrees/{repo}/{slug}
  try {
    await symlink(relative(dirname(wtPath), paths.worktreePoolEntry(repo, slug)), wtPath);
  } catch (e) {
    // Rollback pool entry if we created it
    if (poolEntryCreated) {
      try {
        await gitRemoveWorktree(realRepoPath, poolEntryPath, true, env);
      } catch {
        /* best-effort */
      }
    }
    return err(`Failed to create workspace symlink: ${String(e)}`, "SYMLINK_CREATE_FAILED");
  }

  // Register workspace in pool metadata
  const refResult = await addPoolReference(paths.worktreePoolConfig, repo, slug, workspace);
  if (!refResult.ok) {
    // Rollback: remove symlink and optionally pool entry
    try {
      await rm(wtPath);
    } catch {
      /* best-effort */
    }
    if (poolEntryCreated) {
      try {
        await gitRemoveWorktree(realRepoPath, poolEntryPath, true, env);
      } catch {
        /* best-effort */
      }
    }
    return refResult;
  }

  const entry: AddWorktreeResult = { repo, slug, branch, type: "worktree" };

  // Run setup in the new worktree (detect ecosystem from main repo root)
  if (options.noSetup) {
    return ok({ ...entry, setupSkipped: true });
  }

  const ecosystem = await detectEcosystem(repoEntry.path);
  const config = await loadCommandConfig(repoEntry.path);
  const setupCmd = resolveCommand("setup", config, ecosystem, {});

  if (!setupCmd) {
    return ok({ ...entry, setupSkipped: true });
  }

  const setupResult = await spawnCommand(setupCmd, poolEntryPath);
  if (setupResult.exitCode !== 0) {
    process.stderr.write(
      `[warn] Setup command exited with code ${setupResult.exitCode} — worktree "${slug}" created but setup may be incomplete\n`,
    );
  }
  return ok({ ...entry, setupResult });
}

export async function listWorktrees(
  workspace: string,
  repo: string,
  paths: Paths,
): Promise<Result<WorktreeEntry[]>> {
  const repoDir = paths.repoDir(workspace, repo);
  if (!(await exists(repoDir))) {
    return ok([]);
  }

  let entries: string[];
  try {
    entries = await readdir(repoDir);
  } catch {
    return ok([]);
  }

  const worktrees: WorktreeEntry[] = [];

  for (const slug of entries) {
    const wtPath = paths.worktreeDir(workspace, repo, slug);
    const kind = await classifyWorktreeEntry(wtPath, paths);
    if (kind === "pool" || kind === "legacy") {
      worktrees.push({ repo, slug, branch: slug, type: "worktree" });
    } else if (kind === "linked") {
      worktrees.push({ repo, slug, branch: slug, type: "linked" });
    }
    // null: skip
  }

  return ok(worktrees);
}

export interface PruneEntry {
  repo: string;
  slug: string;
}

export interface PruneResult {
  pruned: PruneEntry[];
}

export async function pruneWorktrees(
  workspace: string,
  paths: Paths,
  env?: GitEnv,
): Promise<Result<PruneResult>> {
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    if (configResult.code === "CONFIG_NOT_FOUND") {
      return err(`Workspace "${workspace}" not found`, "WORKSPACE_NOT_FOUND");
    }
    return configResult;
  }

  const pruned: PruneEntry[] = [];

  for (const repo of configResult.value.repos) {
    const repoTreeDir = paths.repoDir(workspace, repo.name);
    if (!(await exists(repoTreeDir))) {
      continue;
    }

    let entries: string[];
    try {
      entries = await readdir(repoTreeDir);
    } catch {
      continue;
    }

    // Determine which slug to protect as the default-branch entry.
    // getDefaultBranch reads HEAD from repo.path (the main worktree), so it returns the
    // currently checked-out branch, not a stored "canonical" default. If the user has
    // switched branches on their main worktree, this may return the wrong slug — in the
    // obscure double-fault case where repos/ is also dangling at the same time, the old
    // default-branch linked symlink could be incorrectly pruned. ws sync would recreate it.
    let defaultSlug: string | null = null;
    try {
      const branchResult = await getDefaultBranch(repo.path, env);
      if (branchResult.ok) {
        defaultSlug = toSlug(branchResult.value);
      }
    } catch {
      // repo.path inaccessible — treat as unknown, skip all linked entries
    }

    for (const slug of entries) {
      const wtPath = paths.worktreeDir(workspace, repo.name, slug);
      const kind = await classifyWorktreeEntry(wtPath, paths);
      if (kind === "linked") {
        // Cannot determine default branch — skip all linked to avoid pruning it.
        if (defaultSlug === null) {
          continue;
        }
        // Default-branch linked symlinks are repaired by syncWorkspace, not pruned.
        if (slug === defaultSlug) {
          continue;
        }
        // Target exists — not dangling.
        if (await exists(wtPath)) {
          continue;
        }
        // Best-effort removal.
        try {
          await rm(wtPath, { force: true });
        } catch {
          continue;
        }
        pruned.push({ repo: repo.name, slug });
        continue;
      }
      if (kind !== "pool") {
        continue;
      }
      if (await exists(wtPath)) {
        continue; // target exists — not dangling
      }

      // Dangling pool symlink — remove symlink first, then clean pool ref.
      try {
        await rm(wtPath, { force: true });
      } catch {
        continue; // can't remove symlink (EPERM etc.) — skip this entry
      }

      await removePoolWorktree(
        workspace,
        repo.name,
        slug,
        { force: true, skipSymlink: true },
        paths,
        env,
      );
      // Pool ref cleanup is best-effort — stale entries are harmless

      pruned.push({ repo: repo.name, slug });
    }

    // Second pass: clean up orphaned worktrees.json entries (no symlink, no pool dir)
    // Note: first pass already updated worktrees.json, so getPoolSlugsForWorkspace
    // returns only entries not yet cleaned.
    const slugsResult = await getPoolSlugsForWorkspace(
      paths.worktreePoolConfig,
      repo.name,
      workspace,
    );
    if (slugsResult.ok) {
      for (const slug of slugsResult.value) {
        const wtPath = paths.worktreeDir(workspace, repo.name, slug);
        const poolEntry = paths.worktreePoolEntry(repo.name, slug);
        // Symlink present means this entry is live or dangling-but-visible (first pass handles it)
        let symlinkExists = false;
        try {
          await lstat(wtPath);
          symlinkExists = true;
        } catch {
          /* gone */
        }
        if (symlinkExists) {
          continue;
        }
        // Pool dir still present means the worktree is live
        if (await exists(poolEntry)) {
          continue;
        }

        const removeResult = await removePoolWorktree(
          workspace,
          repo.name,
          slug,
          { force: true, skipSymlink: true },
          paths,
          env,
        );
        if (removeResult.ok) {
          pruned.push({ repo: repo.name, slug });
        }
      }
    }
  }

  return ok({ pruned });
}

export async function removeWorktree(
  workspace: string,
  repo: string,
  slug: string,
  options: { force?: boolean },
  paths: Paths,
  env?: GitEnv,
): Promise<Result<void>> {
  const wtPath = paths.worktreeDir(workspace, repo, slug);
  const kind = await classifyWorktreeEntry(wtPath, paths);

  if (kind === null) {
    // Symlink is gone — check if worktrees.json still has this slug for this workspace
    const slugsResult = await getPoolSlugsForWorkspace(paths.worktreePoolConfig, repo, workspace);
    if (slugsResult.ok && slugsResult.value.includes(slug)) {
      const removeResult = await removePoolWorktree(
        workspace,
        repo,
        slug,
        { ...options, skipSymlink: true },
        paths,
        env,
      );
      if (!removeResult.ok) {
        return removeResult;
      }
      if (removeResult.value.gitWarning) {
        return err(removeResult.value.gitWarning, "GIT_WORKTREE_REMOVE_ERROR");
      }
      return ok(undefined);
    }
    return err(`Worktree "${slug}" not found in repo "${repo}"`, "WORKTREE_NOT_FOUND");
  }

  if (kind === "pool") {
    const removeResult = await removePoolWorktree(workspace, repo, slug, options, paths, env);
    if (!removeResult.ok) {
      return removeResult;
    }
    if (removeResult.value.gitWarning) {
      return err(removeResult.value.gitWarning, "GIT_WORKTREE_REMOVE_ERROR");
    }
    return ok(undefined);
  }

  if (kind === "legacy") {
    const repoPathResult = await resolveRepoPath(repo, paths);
    if (!repoPathResult.ok) {
      return repoPathResult;
    }
    return gitRemoveWorktree(repoPathResult.value, wtPath, options.force, env);
  }

  // linked (default-branch or unreadable symlink)
  return err(
    `Cannot remove default branch symlink "${slug}". Remove the repo instead.`,
    "CANNOT_REMOVE_DEFAULT_BRANCH",
  );
}
