import { resolve } from "node:path";

import type { Paths } from "../constants";
import { resolveRepoFromFile } from "../context";
import {
  loadCommandConfig,
  resolveCommand,
  type StandardCommand,
  spawnCommand,
} from "../lib/commands";
import { readRepoFromWorkspace, readWorkspaceConfig } from "../lib/config";
import { detectEcosystem } from "../lib/detect";
import { type ExecResult, err, ok, type Result } from "../types";

export type { StandardCommand };

export interface ExecOptions {
  file?: string;
  match?: string;
  repo?: string;
  dryRun?: boolean;
}

export async function execCommand(
  workspace: string,
  command: StandardCommand,
  opts: ExecOptions,
  paths: Paths,
): Promise<Result<ExecResult>> {
  // 1. Resolve repo, worktree root, and main repo path for ecosystem detection
  let repo: string;
  let worktreeRoot: string;
  let mainRepoPath: string;

  if (opts.repo) {
    const result = await readRepoFromWorkspace(workspace, opts.repo, paths);
    if (!result.ok) {
      return result;
    }
    const { repo: repoEntry } = result.value;
    repo = repoEntry.name;
    worktreeRoot = repoEntry.path;
    mainRepoPath = repoEntry.path;
  } else if (opts.file) {
    const configResult = await readWorkspaceConfig(workspace, paths);
    if (!configResult.ok) {
      return configResult;
    }
    const resolved = await resolveRepoFromFile(opts.file, workspace, paths);
    if (!resolved.ok) {
      return resolved;
    }
    repo = resolved.value.repo;
    worktreeRoot = resolved.value.worktreeRoot;
    const repoEntry = configResult.value.repos.find((r) => r.name === repo);
    if (!repoEntry) {
      return err(`Repo "${repo}" not found in workspace config`, "REPO_NOT_FOUND");
    }
    mainRepoPath = repoEntry.path;
  } else {
    // Validate workspace exists before reporting the missing-repo error
    const configResult = await readWorkspaceConfig(workspace, paths);
    if (!configResult.ok) {
      return configResult;
    }
    return err("No repo or file specified — pass --repo or a file path", "REPO_NOT_RESOLVED");
  }

  // 2. Detect ecosystem and load config — both from the main repo root (lockfile lives there)
  const ecosystem = await detectEcosystem(mainRepoPath);
  const config = await loadCommandConfig(mainRepoPath);

  // 3. Resolve command — resolve file to absolute so it works when cwd ≠ worktreeRoot
  const file = opts.file ? resolve(opts.file) : undefined;
  const cmd = resolveCommand(command, config, ecosystem, {
    file,
    match: opts.match,
  });
  if (!cmd) {
    const detail = config
      ? `configured commands: ${Object.keys(config).join(", ") || "none"}`
      : `no .grove/commands.json and no ecosystem signal detected`;
    return err(
      `Command "${command}" is not configured for repo "${repo}". ${detail}`,
      "COMMAND_NOT_CONFIGURED",
    );
  }

  // 4. Dry-run short-circuit
  if (opts.dryRun) {
    return ok({
      repo,
      cwd: worktreeRoot,
      command: cmd,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  }

  // 5. Spawn
  const spawnResult = await spawnCommand(cmd, worktreeRoot);
  return ok({ repo, cwd: worktreeRoot, command: cmd, ...spawnResult });
}
