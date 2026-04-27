import type { ErrorCode } from "./lib/errors";
import type { HelpView } from "./lib/render/formatters/help";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: ErrorCode; help?: HelpView };

export { ERROR_CATALOG, type ErrorCode, type ErrorEntry, err, ok } from "./lib/errors";

export interface RepoEntry {
  name: string;
  path: string;
}

export interface WorkspaceConfig {
  name: string;
  repos: RepoEntry[];
}

export interface WorktreeEntry {
  repo: string;
  slug: string;
  branch: string;
  type: "linked" | "worktree";
}

export interface Context {
  workspace?: string;
  workspacePath?: string;
  repo?: string;
  worktree?: string;
}

export type WorktreePool = Record<string, Record<string, string[]>>;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecResult {
  repo: string;
  cwd: string;
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}
