import { exists } from "node:fs/promises";

import { err, ok, type Result } from "../types";

export interface GitEnv {
  GIT_CONFIG_NOSYSTEM?: string;
  GIT_AUTHOR_NAME?: string;
  GIT_AUTHOR_EMAIL?: string;
  GIT_COMMITTER_NAME?: string;
  GIT_COMMITTER_EMAIL?: string;
  HOME?: string;
  [key: string]: string | undefined;
}

async function spawnGit(
  args: string[],
  cwd: string,
  env?: GitEnv,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const mergedEnv = env ? { ...process.env, ...env } : process.env;
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      env: mergedEnv as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      success: exitCode === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  if (!(await exists(path))) {
    return false;
  }
  const result = await spawnGit(["rev-parse", "--git-dir"], path);
  return result.success;
}

export async function getDefaultBranch(repoPath: string, env?: GitEnv): Promise<Result<string>> {
  const result = await spawnGit(["symbolic-ref", "--short", "HEAD"], repoPath, env);
  if (!result.success || !result.stdout) {
    return err("Could not determine default branch", "GIT_DEFAULT_BRANCH_ERROR");
  }
  return ok(result.stdout);
}

export interface AddWorktreeOptions {
  newBranch?: boolean;
  from?: string;
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  options: AddWorktreeOptions = {},
  env?: GitEnv,
): Promise<Result<void>> {
  let args: string[];

  if (options.newBranch) {
    args = ["worktree", "add", "-b", branch, worktreePath];
    if (options.from) {
      args.push(options.from);
    }
  } else {
    args = ["worktree", "add", worktreePath, branch];
  }

  const result = await spawnGit(args, repoPath, env);
  if (!result.success) {
    return err(result.stderr || "git worktree add failed", "GIT_WORKTREE_ADD_ERROR");
  }
  return ok(undefined);
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
  env?: GitEnv,
): Promise<Result<void>> {
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(worktreePath);

  const result = await spawnGit(args, repoPath, env);
  if (!result.success) {
    // If worktree dir already gone, git still succeeds usually, but handle edge cases
    if (
      result.stderr.includes("is not a working tree") ||
      result.stderr.includes("does not exist")
    ) {
      return ok(undefined);
    }
    return err(result.stderr || "git worktree remove failed", "GIT_WORKTREE_REMOVE_ERROR");
  }
  return ok(undefined);
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  isDetached: boolean;
}

export async function listWorktrees(
  repoPath: string,
  env?: GitEnv,
): Promise<Result<WorktreeInfo[]>> {
  const result = await spawnGit(["worktree", "list", "--porcelain"], repoPath, env);
  if (!result.success) {
    return err(result.stderr || "git worktree list failed", "GIT_WORKTREE_LIST_ERROR");
  }

  const worktrees: WorktreeInfo[] = [];
  const blocks = result.stdout.split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }
    const lines = block.split("\n");
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const detachedLine = lines.find((l) => l === "detached");

    if (!pathLine) {
      continue;
    }
    const path = pathLine.slice("worktree ".length);
    const branch = branchLine ? branchLine.slice("branch refs/heads/".length) : "";
    const isDetached = !!detachedLine;

    worktrees.push({ path, branch, isDetached });
  }

  return ok(worktrees);
}

export async function findMainWorktreePath(
  repoPath: string,
  env?: GitEnv,
): Promise<Result<string>> {
  const result = await listWorktrees(repoPath, env);
  if (!result.ok) {
    return result;
  }
  // The first worktree in the list is always the main one
  if (result.value.length === 0) {
    return err("No worktrees found", "GIT_WORKTREE_LIST_ERROR");
  }
  return ok(result.value[0].path);
}
