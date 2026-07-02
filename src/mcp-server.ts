import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { touchContext } from "./commands/context";
import { execCommand } from "./commands/exec";
import { getStatus } from "./commands/status";
import { syncWorkspace } from "./commands/workspace";
import { addWorktree, removeWorktree } from "./commands/worktree";
import type { Paths } from "./constants";
import type { ContextLedger } from "./lib/context-ledger";
import type { DisclosureRecorder } from "./lib/context-state";
import {
  buildToolInputSchema,
  CONTEXT_TOUCH_BINDING,
  EXEC_BINDING,
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
} from "./lib/help/mcp-schema";
import type { AsyncMutex } from "./lib/mutex";
import { contextText } from "./lib/render/formatters/context";
import type { FormatCtx } from "./lib/render/formatters/workspace";

const WORKTREE_ADD_INPUT_SCHEMA = buildToolInputSchema(WORKTREE_ADD_BINDING);
const WORKTREE_REMOVE_INPUT_SCHEMA = buildToolInputSchema(WORKTREE_REMOVE_BINDING);
const EXEC_INPUT_SCHEMA = buildToolInputSchema(EXEC_BINDING);
const CONTEXT_TOUCH_INPUT_SCHEMA = buildToolInputSchema(CONTEXT_TOUCH_BINDING);

// Minimal rendering context for agent-facing text: MCP responses are consumed
// by a model, not a terminal, so color/unicode/TTY affordances are irrelevant.
const TEXT_CTX: FormatCtx = { colorEnabled: false, unicodeEnabled: false, isTTY: false };

const SERVER_INSTRUCTIONS = `Grove manages this workspace's instruction context.
Call context_touch with the file or directory paths you are about to work on,
whenever you start working somewhere you have not touched this session. It is
idempotent and cheap to over-call: already-served scopes return one-line
"current" markers; only new or changed instruction content is returned in full.`;

interface McpServerOptions {
  writeLock?: AsyncMutex;
  onStateChange?: () => void | Promise<void>;
  /** Per-session served-state for context disclosure. Consumed by the context_touch tool registered below. */
  contextLedger?: ContextLedger;
  /** Shared observability sink for context disclosure. Consumed by the context_touch tool registered below. */
  recorder?: DisclosureRecorder;
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
  const { writeLock, onStateChange, contextLedger, recorder } = options ?? {};
  const server = new McpServer(
    { name: "grove", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

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

  server.registerTool(
    "context_touch",
    {
      description:
        "Serve instruction context for paths you are about to work on. Call when you begin working under a directory you haven't touched this session. Idempotent and cheap to over-call — repeats cost one line. Pass refresh=true to re-serve everything (e.g. after context loss).",
      inputSchema: CONTEXT_TOUCH_INPUT_SCHEMA,
    },
    async ({ paths: touchPaths, refresh }) => {
      const result = await touchContext(
        workspace,
        touchPaths,
        {
          cwd: paths.workspace(workspace),
          refresh,
          ledger: contextLedger,
          recorder,
          trigger: "mcp",
        },
        paths,
      );
      if (!result.ok) {
        return toErrorContent(`${result.error} [${result.code}]`);
      }
      // Agent-facing text rendering, not raw JSON: the consumer is a model.
      return { content: [{ type: "text" as const, text: contextText(result.value, TEXT_CTX) }] };
    },
  );

  return server;
}
