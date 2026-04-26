import type { Paths } from "../constants";
import { readWorkspaceConfig } from "../lib/config";
import { ok, type Result, type WorktreeEntry } from "../types";
import { listRepos, type RepoInfo } from "./repo";
import { listWorktrees } from "./worktree";

export interface RepoStatus extends RepoInfo {
  worktrees: WorktreeEntry[];
}

export interface WorkspaceStatus {
  name: string;
  path: string;
  repos: RepoStatus[];
}

export async function getStatus(workspace: string, paths: Paths): Promise<Result<WorkspaceStatus>> {
  const wsPath = paths.workspace(workspace);
  const configResult = await readWorkspaceConfig(workspace, paths);
  if (!configResult.ok) {
    return configResult;
  }

  const reposResult = await listRepos(workspace, paths);
  if (!reposResult.ok) {
    return reposResult;
  }

  const repoStatuses: RepoStatus[] = [];

  for (const repo of reposResult.value) {
    const wtResult = await listWorktrees(workspace, repo.name, paths);
    const worktrees = wtResult.ok ? wtResult.value : [];
    repoStatuses.push({ ...repo, worktrees });
  }

  return ok({
    name: workspace,
    path: wsPath,
    repos: repoStatuses,
  });
}
