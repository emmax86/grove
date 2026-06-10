import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { execCommand } from "./commands/exec";
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

const WORKTREE_ADD_INPUT_SCHEMA = buildToolInputSchema(WORKTREE_ADD_BINDING);
const WORKTREE_REMOVE_INPUT_SCHEMA = buildToolInputSchema(WORKTREE_REMOVE_BINDING);
const EXEC_INPUT_SCHEMA = buildToolInputSchema(EXEC_BINDING);

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
      inputSchema: WORKTREE_ADD_INPUT_SCHEMA,
    },
    async ({ repo, branch, newBranch, from, noSetup }) => {
      const run = async () =>
        addWorktree(
          workspace,
          repo,
          branch,
          {
            newBranch,
            from,
            noSetup,
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
      inputSchema: WORKTREE_REMOVE_INPUT_SCHEMA,
    },
    async ({ repo, slug, force }) => {
      const run = async () => removeWorktree(workspace, repo, slug, { force }, paths);
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
        "Run a standard command (setup, format, test, test:file, test:match, check) in a repo. Auto-detects the tool from lockfiles; per-repo .grove/commands.json overrides take precedence.",
      inputSchema: EXEC_INPUT_SCHEMA,
    },
    async ({ command, repo, file, match, dryRun }) => {
      const result = await execCommand(
        workspace,
        command,
        {
          repo,
          file,
          match,
          dryRun,
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
