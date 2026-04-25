import type { Result } from "../../types";
import { formatError } from "./formatters/errors";
import { execDryRunPorcelain, execDryRunText } from "./formatters/exec";
import {
  repoAddPorcelain,
  repoAddText,
  repoListPorcelain,
  repoListText,
  repoRemovePorcelain,
  repoRemoveText,
} from "./formatters/repo";
import { statusPorcelain, statusText } from "./formatters/status";
import {
  workspaceAddPorcelain,
  workspaceAddText,
  workspaceListPorcelain,
  workspaceListText,
  workspacePathPorcelain,
  workspacePathText,
  workspaceRemovePorcelain,
  workspaceRemoveText,
  workspaceSyncPorcelain,
  workspaceSyncText,
} from "./formatters/workspace";
import {
  worktreeAddPorcelain,
  worktreeAddText,
  worktreeListPorcelain,
  worktreeListText,
  worktreePrunePorcelain,
  worktreePruneText,
  worktreeRemovePorcelain,
  worktreeRemoveText,
} from "./formatters/worktree";

export type RenderMode = "text" | "porcelain" | "json";

export interface RenderContext {
  mode: RenderMode;
  colorEnabled: boolean;
  unicodeEnabled: boolean;
  isTTY: boolean; // stdout is TTY
  isStderrTTY: boolean; // stderr is TTY
  warnings: string[];
}

export type CommandKind =
  | "workspace-add"
  | "workspace-list"
  | "workspace-remove"
  | "workspace-path"
  | "workspace-sync"
  | "repo-add"
  | "repo-list"
  | "repo-remove"
  | "worktree-add"
  | "worktree-list"
  | "worktree-remove"
  | "worktree-prune"
  | "status"
  | "exec-dry-run";

export interface RenderOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const KNOWN_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  "workspace-add",
  "workspace-list",
  "workspace-remove",
  "workspace-path",
  "workspace-sync",
  "repo-add",
  "repo-list",
  "repo-remove",
  "worktree-add",
  "worktree-list",
  "worktree-remove",
  "worktree-prune",
  "status",
  "exec-dry-run",
]);

export function render<T>(result: Result<T>, kind: CommandKind, ctx: RenderContext): RenderOutput {
  if (!KNOWN_KINDS.has(kind)) {
    throw new Error(`render: unknown command kind '${kind}'`);
  }

  if (!result.ok) {
    if (ctx.mode === "json") {
      const payload = { ok: false, error: result.error, code: result.code };
      const stderr = ctx.isStderrTTY ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
      return { stdout: "", stderr, exitCode: 1 };
    }
    return {
      stdout: "",
      stderr: formatError(result.error, result.code, { colorEnabled: ctx.colorEnabled }),
      exitCode: 1,
    };
  }

  if (ctx.mode === "json") {
    const payload = { ok: true, data: result.value };
    const stdout = ctx.isTTY ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    return { stdout, stderr: "", exitCode: 0 };
  }

  const stdout = renderTextOrPorcelain(result.value, kind, ctx);
  return { stdout, stderr: "", exitCode: 0 };
}

function renderTextOrPorcelain<T>(value: T, kind: CommandKind, ctx: RenderContext): string {
  switch (kind) {
    case "workspace-add":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: dispatcher accepts the value typed by the kind
          workspaceAddText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceAddPorcelain(value as any);
    case "workspace-list":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceListText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceListPorcelain(value as any);
    case "workspace-remove":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceRemoveText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceRemovePorcelain(value as any);
    case "workspace-path":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          workspacePathText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          workspacePathPorcelain(value as any);
    case "workspace-sync":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceSyncText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          workspaceSyncPorcelain(value as any);
    case "repo-add":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: dispatcher accepts the value typed by the kind
          repoAddText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          repoAddPorcelain(value as any);
    case "repo-list":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          repoListText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          repoListPorcelain(value as any);
    case "repo-remove":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          repoRemoveText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          repoRemovePorcelain(value as any);
    case "worktree-add":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: dispatcher accepts the value typed by the kind
          worktreeAddText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          worktreeAddPorcelain(value as any);
    case "worktree-list":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          worktreeListText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          worktreeListPorcelain(value as any);
    case "worktree-remove":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          worktreeRemoveText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          worktreeRemovePorcelain(value as any);
    case "worktree-prune":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: same
          worktreePruneText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          worktreePrunePorcelain(value as any);
    case "status":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: dispatcher accepts the value typed by the kind
          statusText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          statusPorcelain(value as any);
    case "exec-dry-run":
      return ctx.mode === "text"
        ? // biome-ignore lint/suspicious/noExplicitAny: dispatcher accepts the value typed by the kind
          execDryRunText(value as any, ctx)
        : // biome-ignore lint/suspicious/noExplicitAny: same
          execDryRunPorcelain(value as any);
  }
}
