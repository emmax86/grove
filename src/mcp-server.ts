import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { execCommand } from "./commands/exec";
import { listRepos } from "./commands/repo";
import { getStatus } from "./commands/status";
import { syncWorkspace } from "./commands/workspace";
import { addWorktree, listWorktrees, removeWorktree } from "./commands/worktree";
import type { Paths } from "./constants";
import type { AsyncMutex } from "./lib/mutex";

interface McpServerOptions {
  writeLock?: AsyncMutex;
}

function toErrorContent(error: string) {
  return { content: [{ type: "text" as const, text: error }], isError: true };
}

function toJsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMcpServer(
  workspace: string,
  paths: Paths,
  options?: McpServerOptions,
): McpServer {
  const { writeLock } = options ?? {};
  const server = new McpServer({ name: "grove", version: "1.0.0" });

  // ── Resources ────────────────────────────────────────────────────

  server.registerResource(
    "workspace-status",
    "grove://workspace/status",
    { description: "Current workspace state (name, repo count, worktree count)" },
    async () => {
      const result = await getStatus(workspace, paths);
      if (!result.ok) {
        return {
          contents: [
            { uri: "grove://workspace/status", text: JSON.stringify({ error: result.error }) },
          ],
        };
      }
      const { name, repos } = result.value;
      const worktreeCount = repos.reduce((sum, r) => sum + r.worktrees.length, 0);
      const data = { name, repoCount: repos.length, worktreeCount };
      return { contents: [{ uri: "grove://workspace/status", text: JSON.stringify(data) }] };
    },
  );

  server.registerResource(
    "workspace-repos",
    "grove://workspace/repos",
    { description: "Registered repos with paths and status" },
    async () => {
      const result = await listRepos(workspace, paths);
      const data = result.ok ? result.value : [];
      return { contents: [{ uri: "grove://workspace/repos", text: JSON.stringify(data) }] };
    },
  );

  server.registerResource(
    "workspace-worktrees",
    "grove://workspace/worktrees",
    { description: "All worktrees across repos" },
    async () => {
      const reposResult = await listRepos(workspace, paths);
      const repos = reposResult.ok ? reposResult.value : [];
      const all = [];
      for (const repo of repos) {
        const wtResult = await listWorktrees(workspace, repo.name, paths);
        if (wtResult.ok) {
          all.push(...wtResult.value);
        }
      }
      return { contents: [{ uri: "grove://workspace/worktrees", text: JSON.stringify(all) }] };
    },
  );

  server.registerResource(
    "workspace-context",
    "grove://workspace/context",
    { description: "Full workspace context including repos and worktrees" },
    async () => {
      const result = await getStatus(workspace, paths);
      const data = result.ok ? result.value : { error: result.error };
      return { contents: [{ uri: "grove://workspace/context", text: JSON.stringify(data) }] };
    },
  );

  // ── Tools ────────────────────────────────────────────────────────

  server.registerTool(
    "workspace_status",
    { description: "Get current workspace state" },
    async () => {
      const result = await getStatus(workspace, paths);
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      return toJsonContent(result.value);
    },
  );

  server.registerTool(
    "workspace_path",
    { description: "Get the workspace root path" },
    async () => {
      return toJsonContent({ path: paths.workspace(workspace) });
    },
  );

  server.registerTool(
    "workspace_sync",
    { description: "Repair workspace: recreate missing symlinks, prune dangling worktrees" },
    async () => {
      const run = async () => syncWorkspace(workspace, paths);
      const result = await (writeLock ? writeLock.run(run) : run());
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      return toJsonContent(result.value);
    },
  );

  server.registerTool(
    "workspace_add_worktree",
    {
      description: "Create a git worktree for a repo",
      inputSchema: {
        repo: z.string().describe("Repo name"),
        branch: z.string().describe("Branch name"),
        newBranch: z.boolean().optional().describe("Create a new branch"),
        from: z.string().optional().describe("Base branch to create from"),
        noSetup: z.boolean().optional().describe("Skip automatic setup after checkout"),
      },
    },
    async ({ repo, branch, newBranch, from, noSetup }) => {
      const run = async () =>
        addWorktree(workspace, repo, branch, { newBranch, from, noSetup }, paths);
      const result = await (writeLock ? writeLock.run(run) : run());
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      return toJsonContent(result.value);
    },
  );

  server.registerTool(
    "workspace_remove_worktree",
    {
      description: "Remove a git worktree",
      inputSchema: {
        repo: z.string().describe("Repo name"),
        slug: z.string().describe("Worktree slug (branch name slugified)"),
        force: z.boolean().optional().describe("Force removal even if branch has changes"),
      },
    },
    async ({ repo, slug, force }) => {
      const run = async () => removeWorktree(workspace, repo, slug, { force }, paths);
      const result = await (writeLock ? writeLock.run(run) : run());
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      return toJsonContent({ ok: true });
    },
  );

  server.registerTool(
    "workspace_exec",
    {
      description:
        "Run a standard command (setup, format, test, check) in a repo. Auto-detects the tool from lockfiles; per-repo .grove/commands.json overrides take precedence.",
      inputSchema: {
        command: z
          .enum(["setup", "format", "test", "test:file", "test:match", "check"])
          .describe("Standard command to run"),
        repo: z.string().optional().describe("Repo name (overrides file-based resolution)"),
        file: z.string().optional().describe("Target file path (triggers repo resolution)"),
        match: z.string().optional().describe("Test pattern filter for test:match"),
        dryRun: z.boolean().optional().describe("Return resolved command without executing"),
      },
    },
    async ({ command, repo, file, match, dryRun }) => {
      const result = await execCommand(workspace, command, { repo, file, match, dryRun }, paths);
      if (!result.ok) {
        return toErrorContent(`${result.error} [${result.code}]`);
      }
      return toJsonContent(result.value);
    },
  );

  return server;
}
