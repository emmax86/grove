import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { execCommand, type StandardCommand } from "./commands/exec";
import { getStatus } from "./commands/status";
import { syncWorkspace } from "./commands/workspace";
import { addWorktree, removeWorktree } from "./commands/worktree";
import type { Paths } from "./constants";
import {
  buildToolInputSchema,
  EXEC_BINDING,
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
} from "./lib/help/mcp-schema";
import type { AsyncMutex } from "./lib/mutex";

interface McpServerOptions {
  writeLock?: AsyncMutex;
  onStateChange?: () => void | Promise<void>;
}

function toErrorContent(error: string) {
  return { content: [{ type: "text" as const, text: error }], isError: true };
}

function toJsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createMcpServer(
  workspace: string,
  paths: Paths,
  options?: McpServerOptions,
): McpServer {
  const { writeLock, onStateChange } = options ?? {};
  const server = new McpServer({ name: "grove", version: "1.0.0" });

  // ── Resources ────────────────────────────────────────────────────

  server.registerResource(
    "workspace-context",
    "grove://workspace/context",
    { description: "Full workspace context: name, path, repos with worktrees" },
    async () => {
      const result = await getStatus(workspace, paths);
      const data = result.ok ? result.value : { error: result.error, code: result.code };
      return {
        contents: [
          {
            uri: "grove://workspace/context",
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
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
    {
      description: "Repair workspace: recreate missing symlinks, prune dangling worktrees",
    },
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
      inputSchema: buildToolInputSchema(WORKTREE_ADD_BINDING),
    },
    async ({ repo, branch, newBranch, from, noSetup }) => {
      const run = async () =>
        addWorktree(
          workspace,
          repo as string,
          branch as string,
          {
            newBranch: newBranch as boolean | undefined,
            from: from as string | undefined,
            noSetup: noSetup as boolean | undefined,
          },
          paths,
        );
      const result = await (writeLock ? writeLock.run(run) : run());
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      try {
        await onStateChange?.();
      } catch (e) {
        process.stderr.write(`[mcp] onStateChange failed: ${e}\n`);
      }
      return toJsonContent(result.value);
    },
  );

  server.registerTool(
    "workspace_remove_worktree",
    {
      description: "Remove a git worktree",
      inputSchema: buildToolInputSchema(WORKTREE_REMOVE_BINDING),
    },
    async ({ repo, slug, force }) => {
      const run = async () =>
        removeWorktree(
          workspace,
          repo as string,
          slug as string,
          { force: force as boolean | undefined },
          paths,
        );
      const result = await (writeLock ? writeLock.run(run) : run());
      if (!result.ok) {
        return toErrorContent(result.error);
      }
      try {
        await onStateChange?.();
      } catch (e) {
        process.stderr.write(`[mcp] onStateChange failed: ${e}\n`);
      }
      return toJsonContent({ ok: true });
    },
  );

  server.registerTool(
    "workspace_exec",
    {
      description:
        "Run a standard command (setup, format, test, check, test:file, test:match) in a repo. Auto-detects the tool from lockfiles; per-repo .grove/commands.json overrides take precedence.",
      inputSchema: buildToolInputSchema(EXEC_BINDING),
    },
    async ({ command, repo, file, match, dryRun }) => {
      const result = await execCommand(
        workspace,
        command as StandardCommand,
        {
          repo: repo as string | undefined,
          file: file as string | undefined,
          match: match as string | undefined,
          dryRun: dryRun as boolean | undefined,
        },
        paths,
      );
      if (!result.ok) {
        return toErrorContent(`${result.error} [${result.code}]`);
      }
      return toJsonContent(result.value);
    },
  );

  return server;
}
