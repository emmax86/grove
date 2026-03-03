import {
  exists,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, relative } from "node:path";

import type { Paths } from "../constants";
import { generateClaudeFiles } from "../lib/claude";
import { getPoolSlugsForWorkspace, readConfig, writeConfig } from "../lib/config";
import { type GitEnv, getDefaultBranch, isGitRepo, removeWorktree } from "../lib/git";
import { toSlug } from "../lib/slug";
import { generateVSCodeWorkspace } from "../lib/vscode";
import { classifyWorktreeEntry, removePoolWorktree, resolveRepoPath } from "../lib/worktree-utils";
import { err, ok, type Result, type WorkspaceConfig } from "../types";
import { type PruneEntry, pruneWorktrees } from "./worktree";

const RESERVED_NAMES = new Set(["repos", "worktrees"]);

function validateName(name: string): Result<void> {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return err(`Invalid workspace name: "${name}"`, "INVALID_NAME");
  }
  if (RESERVED_NAMES.has(name)) {
    return err(
      `"${name}" is a reserved name and cannot be used as a workspace name`,
      "RESERVED_NAME",
    );
  }
  return ok(undefined);
}

export interface WorkspaceInfo {
  name: string;
  path: string;
}

export async function addWorkspace(name: string, paths: Paths): Promise<Result<WorkspaceInfo>> {
  const validation = validateName(name);
  if (!validation.ok) {
    return validation;
  }

  const wsPath = paths.workspace(name);
  if (await exists(wsPath)) {
    return err(`Workspace "${name}" already exists`, "WORKSPACE_EXISTS");
  }

  await mkdir(wsPath, { recursive: true });
  await mkdir(paths.workspaceClaudeDir(name), { recursive: true });

  const config: WorkspaceConfig = { name, repos: [] };
  const writeResult = await writeConfig(paths.workspaceConfig(name), config);
  if (!writeResult.ok) {
    return writeResult;
  }

  const vscodeResult = await generateVSCodeWorkspace(name, paths);
  if (!vscodeResult.ok) {
    return vscodeResult;
  }

  const claudeResult = await generateClaudeFiles(name, paths);
  if (!claudeResult.ok) {
    return claudeResult;
  }

  return ok({ name, path: wsPath });
}

export async function listWorkspaces(paths: Paths): Promise<Result<WorkspaceInfo[]>> {
  if (!(await exists(paths.root))) {
    return ok([]);
  }

  const entries = await readdir(paths.root);
  const workspaces: WorkspaceInfo[] = [];

  for (const entry of entries) {
    if (RESERVED_NAMES.has(entry)) {
      continue;
    }
    const wsPath = paths.workspace(entry);
    try {
      const s = await stat(wsPath);
      if (!s.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const configPath = paths.workspaceConfig(entry);
    if (!(await exists(configPath))) {
      continue;
    }
    workspaces.push({ name: entry, path: wsPath });
  }

  return ok(workspaces);
}

export async function removeWorkspace(
  name: string,
  options: { force?: boolean },
  paths: Paths,
  env?: GitEnv,
): Promise<Result<void>> {
  const wsPath = paths.workspace(name);
  if (!(await exists(wsPath))) {
    return err(`Workspace "${name}" not found`, "WORKSPACE_NOT_FOUND");
  }

  const configPath = paths.workspaceConfig(name);
  const configResult = await readConfig(configPath);
  if (!configResult.ok) {
    return configResult;
  }

  const config = configResult.value;

  if (!options.force && config.repos.length > 0) {
    return err(
      `Workspace "${name}" has repos. Use --force to remove anyway.`,
      "WORKSPACE_HAS_REPOS",
    );
  }

  const errors: string[] = [];

  if (options.force && config.repos.length > 0) {
    for (const repo of config.repos) {
      const repoDir = paths.repoDir(name, repo.name);
      if (!(await exists(repoDir))) {
        continue;
      }

      let entries: string[];
      try {
        entries = await readdir(repoDir);
      } catch {
        continue;
      }

      // Collect pool slugs from filesystem entries
      const poolSlugsSet = new Set<string>();
      for (const slug of entries) {
        const wtPath = paths.worktreeDir(name, repo.name, slug);
        const kind = await classifyWorktreeEntry(wtPath, paths);
        if (kind === "pool") {
          poolSlugsSet.add(slug);
        }
      }
      // Union with worktrees.json to catch metadata-only entries (symlink externally deleted)
      const jsonSlugsResult = await getPoolSlugsForWorkspace(
        paths.worktreePoolConfig,
        repo.name,
        name,
      );
      if (jsonSlugsResult.ok) {
        for (const slug of jsonSlugsResult.value) {
          poolSlugsSet.add(slug);
        }
      }

      for (const slug of poolSlugsSet) {
        const removeResult = await removePoolWorktree(
          name,
          repo.name,
          slug,
          { force: true, skipSymlink: true },
          paths,
          env,
        );
        if (!removeResult.ok) {
          errors.push(`${repo.name}/${slug}: ${removeResult.error}`);
        } else if (removeResult.value.gitWarning) {
          errors.push(`${repo.name}/${slug}: ${removeResult.value.gitWarning}`);
        }
      }

      for (const slug of entries) {
        const wtPath = paths.worktreeDir(name, repo.name, slug);
        const kind = await classifyWorktreeEntry(wtPath, paths);
        if (kind === "legacy") {
          const repoPathResult = await resolveRepoPath(repo.name, paths);
          if (!repoPathResult.ok) {
            continue; // dangling — skip
          }
          const removeResult = await removeWorktree(repoPathResult.value, wtPath, true, env);
          if (!removeResult.ok) {
            errors.push(`${repo.name}/${slug}: ${removeResult.error}`);
          }
        }
        // null or linked: skip
      }
    }
  }

  // Always run rm(wsPath) — it cleans workspace symlinks left in place by skipSymlink: true.
  await rm(wsPath, { recursive: true, force: true });

  if (errors.length > 0) {
    return err(`Failed to remove some worktrees:\n${errors.join("\n")}`, "WORKTREE_REMOVE_FAILED");
  }

  return ok(undefined);
}

export interface SyncRepoResult {
  name: string;
  status: "ok" | "repaired" | "dangling";
  repairs: string[];
}

export interface SyncResult {
  repos: SyncRepoResult[];
  pruned: PruneEntry[];
}

export async function syncWorkspace(
  name: string,
  paths: Paths,
  env?: GitEnv,
): Promise<Result<SyncResult>> {
  const wsPath = paths.workspace(name);
  if (!(await exists(wsPath))) {
    return err(`Workspace "${name}" not found`, "WORKSPACE_NOT_FOUND");
  }

  const configResult = await readConfig(paths.workspaceConfig(name));
  if (!configResult.ok) {
    return configResult;
  }

  const config = configResult.value;
  const repoResults: SyncRepoResult[] = [];

  for (const repo of config.repos) {
    const repairs: string[] = [];

    if (!(await isGitRepo(repo.path))) {
      repoResults.push({ name: repo.name, status: "dangling", repairs: [] });
      continue;
    }

    // Ensure repos/<name> symlink exists and points to the right path
    const treePath = paths.repoEntry(repo.name);
    let repoLinkOk = false;
    try {
      await lstat(treePath);
      try {
        const existing = await realpath(treePath);
        const expected = await realpath(repo.path);
        repoLinkOk = existing === expected;
      } catch {
        // dangling symlink
      }
      if (!repoLinkOk) {
        await unlink(treePath);
      }
    } catch {
      // doesn't exist
    }
    if (!repoLinkOk) {
      await mkdir(paths.repos, { recursive: true });
      await symlink(repo.path, treePath);
      repairs.push(`created repos/${repo.name}`);
    }

    // Ensure trees/<repo>/ directory exists
    const repoDirPath = paths.repoDir(name, repo.name);
    if (!(await exists(repoDirPath))) {
      await mkdir(repoDirPath, { recursive: true });
      repairs.push(`created trees/${repo.name}/`);
    }

    // Ensure default-branch symlink exists
    const branchResult = await getDefaultBranch(repo.path, env);
    if (!branchResult.ok) {
      repoResults.push({ name: repo.name, status: "dangling", repairs });
      continue;
    }

    const slug = toSlug(branchResult.value);
    const slugPath = paths.worktreeDir(name, repo.name, slug);
    let slugOk = false;
    try {
      await lstat(slugPath);
      try {
        await realpath(slugPath);
        slugOk = true;
      } catch {
        await unlink(slugPath);
      }
    } catch {
      // doesn't exist
    }
    if (!slugOk) {
      await symlink(relative(dirname(slugPath), paths.repoEntry(repo.name)), slugPath);
      repairs.push(`created trees/${repo.name}/${slug}`);
    }

    repoResults.push({ name: repo.name, status: repairs.length > 0 ? "repaired" : "ok", repairs });
  }

  const vscodeResult = await generateVSCodeWorkspace(name, paths);
  if (!vscodeResult.ok) {
    return vscodeResult;
  }

  const claudeResult = await generateClaudeFiles(name, paths, env);
  if (!claudeResult.ok) {
    return claudeResult;
  }

  const pruneResult = await pruneWorktrees(name, paths, env);
  const pruned = pruneResult.ok ? pruneResult.value.pruned : [];

  return ok({ repos: repoResults, pruned });
}
