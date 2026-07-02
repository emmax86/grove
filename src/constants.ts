import { join } from "node:path";

export interface Paths {
  root: string;
  repos: string;
  workspace: (name: string) => string;
  workspaceConfig: (name: string) => string;
  workspaceGroveDir: (name: string) => string;
  workspaceInstructions: (name: string) => string;
  workspaceClaudeDir: (name: string) => string;
  vscodeWorkspace: (name: string) => string;
  repoEntry: (repoName: string) => string;
  repoDir: (workspace: string, repo: string) => string;
  worktreeDir: (workspace: string, repo: string, slug: string) => string;
  worktreePool: string;
  worktreePoolRepo: (repo: string) => string;
  worktreePoolEntry: (repo: string, slug: string) => string;
  worktreePoolConfig: string;
  claudeTreesMd: (name: string) => string;
  claudeMd: (name: string) => string;
  agentsMd: (name: string) => string;
  daemonConfig: (name: string) => string;
  contextStateDir: (name: string) => string;
  contextJournal: (name: string) => string;
  contextObjects: (name: string) => string;
  mcpJson: (name: string) => string;
}

export function createPaths(root: string): Paths {
  return {
    root,
    repos: join(root, "repos"),
    workspace: (name) => join(root, name),
    workspaceConfig: (name) => join(root, name, "workspace.json"),
    workspaceGroveDir: (name) => join(root, name, ".grove"),
    workspaceInstructions: (name) => join(root, name, ".grove", "instructions.md"),
    workspaceClaudeDir: (name) => join(root, name, ".claude"),
    vscodeWorkspace: (name) => join(root, name, `${name}.code-workspace`),
    repoEntry: (repoName) => join(root, "repos", repoName),
    repoDir: (workspace, repo) => join(root, workspace, "trees", repo),
    worktreeDir: (workspace, repo, slug) => join(root, workspace, "trees", repo, slug),
    worktreePool: join(root, "worktrees"),
    worktreePoolRepo: (repo) => join(root, "worktrees", repo),
    worktreePoolEntry: (repo, slug) => join(root, "worktrees", repo, slug),
    worktreePoolConfig: join(root, "worktrees.json"),
    claudeTreesMd: (name) => join(root, name, ".claude", "trees.md"),
    claudeMd: (name) => join(root, name, "CLAUDE.md"),
    agentsMd: (name) => join(root, name, "AGENTS.md"),
    daemonConfig: (name) => join(root, name, ".claude", "server.json"),
    contextStateDir: (name) => join(root, name, ".grove", "state", "context"),
    contextJournal: (name) => join(root, name, ".grove", "state", "context", "journal.jsonl"),
    contextObjects: (name) => join(root, name, ".grove", "state", "context", "objects"),
    mcpJson: (name) => join(root, name, ".mcp.json"),
  };
}

export const DEFAULT_WORKSPACES_ROOT = join(process.env.HOME ?? "/tmp", "grove-workspaces");

/** Path to per-repo command overrides, relative to the repo root. */
export const REPO_COMMANDS_CONFIG = join(".grove", "commands.json");
