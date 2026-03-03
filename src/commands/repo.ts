import { exists, mkdir, readdir, realpath, rm, symlink } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import type { Paths } from "../constants";
import { generateClaudeFiles } from "../lib/claude";
import {
  addRepoToConfig,
  getPoolSlugsForWorkspace,
  readConfig,
  removeRepoFromConfig,
} from "../lib/config";
import { type GitEnv, getDefaultBranch, isGitRepo, removeWorktree } from "../lib/git";
import { toSlug } from "../lib/slug";
import { generateVSCodeWorkspace } from "../lib/vscode";
import { classifyWorktreeEntry, removePoolWorktree, resolveRepoPath } from "../lib/worktree-utils";
import { err, ok, type RepoEntry, type Result } from "../types";

export interface RepoInfo extends RepoEntry {
  status: "ok" | "dangling";
}

export async function addRepo(
  workspace: string,
  repoPath: string,
  nameOverride: string | undefined,
  paths: Paths,
  env?: GitEnv,
): Promise<Result<RepoInfo>> {
  const absPath = resolve(repoPath);

  if (!(await isGitRepo(absPath))) {
    return err(`"${absPath}" is not a git repository`, "NOT_A_GIT_REPO");
  }

  const name = nameOverride ?? basename(absPath);

  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return err(`Invalid repo name: "${name}"`, "INVALID_NAME");
  }
  if (name === "trees") {
    return err(`"trees" is a reserved name and cannot be used as a repo name`, "RESERVED_NAME");
  }

  // Check if repos/{name} exists pointing to a different path
  const treePath = paths.repoEntry(name);
  if (await exists(treePath)) {
    let existingTarget: string;
    try {
      existingTarget = await realpath(treePath);
    } catch {
      // dangling symlink — treat as pointing to different path
      existingTarget = "";
    }
    let realAbsPath: string;
    try {
      realAbsPath = await realpath(absPath);
    } catch {
      realAbsPath = absPath;
    }
    if (existingTarget !== realAbsPath) {
      return err(
        `repos/${name} already points to a different path. Use --name to pick a different name.`,
        "TREE_NAME_CONFLICT",
      );
    }
    // Same path — reuse existing tree symlink
  } else {
    // Create repos/ lazily
    await mkdir(paths.repos, { recursive: true });
    await symlink(absPath, treePath);
  }

  // Create {workspace}/trees/{repo-name}/ directory
  const repoDirPath = paths.repoDir(workspace, name);
  let repoDirCreated = false;

  async function cleanup() {
    if (repoDirCreated && (await exists(repoDirPath))) {
      await rm(repoDirPath, { recursive: true, force: true });
    }
  }

  if (!(await exists(repoDirPath))) {
    await mkdir(repoDirPath, { recursive: true });
    repoDirCreated = true;
  }

  // Detect default branch and create symlink
  const branchResult = await getDefaultBranch(absPath, env);
  if (!branchResult.ok) {
    await cleanup();
    return branchResult; // preserves GIT_DEFAULT_BRANCH_ERROR
  }

  const slug = toSlug(branchResult.value);
  const defaultBranchSlugPath = paths.worktreeDir(workspace, name, slug);
  if (!(await exists(defaultBranchSlugPath))) {
    // Symlink: {workspace}/trees/{repo}/{slug} -> repos/{repo}
    await symlink(
      relative(dirname(defaultBranchSlugPath), paths.repoEntry(name)),
      defaultBranchSlugPath,
    );
  }

  // Add to workspace.json
  const configResult = await addRepoToConfig(paths.workspaceConfig(workspace), {
    name,
    path: absPath,
  });
  if (!configResult.ok) {
    await cleanup();
    return configResult; // preserves CONFIG_NOT_FOUND etc.
  }

  const vscodeResult = await generateVSCodeWorkspace(workspace, paths);
  if (!vscodeResult.ok) {
    return vscodeResult;
  }

  const claudeResult = await generateClaudeFiles(workspace, paths, env);
  if (!claudeResult.ok) {
    return claudeResult;
  }

  return ok({ name, path: absPath, status: "ok" });
}

export async function listRepos(workspace: string, paths: Paths): Promise<Result<RepoInfo[]>> {
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    if (configResult.code === "CONFIG_NOT_FOUND") {
      return err(`Workspace "${workspace}" not found`, "WORKSPACE_NOT_FOUND");
    }
    return configResult;
  }

  const results: RepoInfo[] = [];
  for (const repo of configResult.value.repos) {
    const treePath = paths.repoEntry(repo.name);
    let status: RepoInfo["status"] = "ok";
    try {
      await realpath(treePath);
    } catch {
      status = "dangling";
    }
    results.push({ ...repo, status });
  }
  return ok(results);
}

export async function removeRepo(
  workspace: string,
  name: string,
  options: { force?: boolean },
  paths: Paths,
  env?: GitEnv,
): Promise<Result<void>> {
  const repoDir = paths.repoDir(workspace, name);
  const forceErrors: string[] = [];

  if (await exists(repoDir)) {
    // Three-way classification of entries:
    // 1. Default-branch symlink (../trees/) — skip, cleaned by rm(repoDir)
    // 2. Pool symlink (../../worktrees/) — count as worktree
    // 3. Legacy real directory — count as worktree
    const entries = await readdir(repoDir);
    const poolSlugs: string[] = [];
    const legacySlugs: string[] = [];

    for (const slug of entries) {
      const wtPath = paths.worktreeDir(workspace, name, slug);
      const kind = await classifyWorktreeEntry(wtPath, paths);
      if (kind === "pool") {
        poolSlugs.push(slug);
      } else if (kind === "legacy") {
        legacySlugs.push(slug);
      }
    }

    // Union with worktrees.json to catch metadata-only entries (symlink externally deleted)
    const jsonSlugsResult = await getPoolSlugsForWorkspace(
      paths.worktreePoolConfig,
      name,
      workspace,
    );
    if (jsonSlugsResult.ok) {
      for (const slug of jsonSlugsResult.value) {
        if (!poolSlugs.includes(slug)) {
          poolSlugs.push(slug);
        }
      }
    }

    const totalWorktrees = poolSlugs.length + legacySlugs.length;

    if (totalWorktrees > 0 && !options.force) {
      const all = [...poolSlugs, ...legacySlugs];
      return err(
        `Repo "${name}" has worktrees: ${all.join(", ")}. Use --force to remove.`,
        "REPO_HAS_WORKTREES",
      );
    }

    if (options.force && totalWorktrees > 0) {
      const repoPathResult = await resolveRepoPath(name, paths);
      const realRepoPath = repoPathResult.ok ? repoPathResult.value : "";

      for (const slug of poolSlugs) {
        const removeResult = await removePoolWorktree(
          workspace,
          name,
          slug,
          { force: true, skipSymlink: true },
          paths,
          env,
        );
        if (!removeResult.ok) {
          forceErrors.push(`${slug}: ${removeResult.error}`);
        } else if (removeResult.value.gitWarning) {
          forceErrors.push(`${slug}: ${removeResult.value.gitWarning}`);
        }
      }

      for (const slug of legacySlugs) {
        const wtPath = paths.worktreeDir(workspace, name, slug);
        if (realRepoPath) {
          const removeResult = await removeWorktree(realRepoPath, wtPath, true, env);
          if (!removeResult.ok) {
            forceErrors.push(`${slug}: ${removeResult.error}`);
          }
        }
      }
    }

    // Always run even when forceErrors occurred — rm(repoDir) cleans workspace symlinks
    // that were left in place by skipSymlink: true above.
    await rm(repoDir, { recursive: true, force: true });
  }

  // Remove from workspace.json (global repo entry stays)
  const removeResult = await removeRepoFromConfig(paths.workspaceConfig(workspace), name);
  if (!removeResult.ok) {
    return removeResult;
  }

  const vscodeResult = await generateVSCodeWorkspace(workspace, paths);
  if (!vscodeResult.ok) {
    return vscodeResult;
  }

  const claudeResult = await generateClaudeFiles(workspace, paths, env);
  if (!claudeResult.ok) {
    return claudeResult;
  }

  if (forceErrors.length > 0) {
    return err(
      `Failed to remove some worktrees:\n${forceErrors.join("\n")}`,
      "WORKTREE_REMOVE_FAILED",
    );
  }

  return ok(undefined);
}
