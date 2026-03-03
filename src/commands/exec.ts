import { resolve } from "node:path";

import type { Paths } from "../constants";
import { resolveRepoFromFile } from "../context";
import {
  loadCommandConfig,
  resolveCommand,
  type StandardCommand,
  spawnCommand,
} from "../lib/commands";
import { readConfig } from "../lib/config";
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
  // 1. Resolve workspace config
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    if (configResult.code === "CONFIG_NOT_FOUND") {
      return err(`Workspace "${workspace}" not found`, "WORKSPACE_NOT_FOUND");
    }
    return configResult;
  }

  // 2. Resolve repo, worktree root, and main repo path for ecosystem detection
  let repo: string;
  let worktreeRoot: string;
  let mainRepoPath: string;

  if (opts.repo) {
    const repoEntry = configResult.value.repos.find((r) => r.name === opts.repo);
    if (!repoEntry) {
      return err(
        `Repo "${opts.repo}" not registered in workspace "${workspace}"`,
        "REPO_NOT_FOUND",
      );
    }
    repo = repoEntry.name;
    worktreeRoot = repoEntry.path;
    mainRepoPath = repoEntry.path;
  } else if (opts.file) {
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
    return err("No repo or file specified — pass --repo or a file path", "REPO_NOT_RESOLVED");
  }

  // 3. Detect ecosystem and load config — both from the main repo root (lockfile lives there)
  const ecosystem = await detectEcosystem(mainRepoPath);
  const config = await loadCommandConfig(mainRepoPath);

  // 4. Resolve command — resolve file to absolute so it works when cwd ≠ worktreeRoot
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

  // 5. Dry-run short-circuit
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

  // 6. Spawn
  const spawnResult = await spawnCommand(cmd, worktreeRoot);
  return ok({ repo, cwd: worktreeRoot, command: cmd, ...spawnResult });
}
