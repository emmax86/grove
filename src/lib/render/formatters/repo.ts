import { chars } from "../ascii";
import { c } from "../color";
import { alignTable } from "../columns";
import type { FormatCtx } from "./workspace";

// ── ws repo add ───────────────────────────────────────────────────────
export interface RepoAddValue {
  name: string;
  path: string;
  status: string;
  workspace: string;
  defaultBranchSlug: string;
  worktreePath: string; // relative path from workspace root, e.g., "trees/grove/main"
}
export function repoAddText(v: RepoAddValue, ctx: FormatCtx): string {
  const arrow = chars(ctx.unicodeEnabled).arrow;
  return `Added repo '${v.name}' ${arrow} ${v.path}\n  worktree: ${v.worktreePath}`;
}
export function repoAddPorcelain(v: RepoAddValue): string {
  return `${v.name}\t${v.path}\t${v.status}`;
}

// ── ws repo list ──────────────────────────────────────────────────────
export interface RepoListItem {
  name: string;
  path: string;
  status: "ok" | "dangling";
}
export function repoListText(items: RepoListItem[], ctx: FormatCtx): string {
  if (items.length === 0) {
    return "";
  }
  const colorize = (s: RepoListItem["status"]) =>
    s === "ok" ? c.cyan(s, ctx.colorEnabled) : c.yellow(s, ctx.colorEnabled);
  const rows = items.map((r) => [r.name, r.path, colorize(r.status)]);
  if (ctx.isTTY) {
    const headers = ["NAME", "PATH", "STATUS"].map((h) => c.bold(h, ctx.colorEnabled));
    return alignTable(rows, { headers });
  }
  return alignTable(rows);
}
export function repoListPorcelain(items: RepoListItem[]): string {
  return items.map((r) => `${r.name}\t${r.path}\t${r.status}`).join("\n");
}

// ── ws repo remove ────────────────────────────────────────────────────
export interface RepoRemoveValue {
  name: string;
  workspace: string;
}
export function repoRemoveText(v: RepoRemoveValue, _ctx: FormatCtx): string {
  return `Removed repo '${v.name}' from workspace '${v.workspace}'`;
}
export function repoRemovePorcelain(v: RepoRemoveValue): string {
  return `${v.name}\tremoved`;
}
