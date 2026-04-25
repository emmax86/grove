import { c } from "../color";
import { alignTable } from "../columns";
import type { FormatCtx } from "./workspace";

// ── ws worktree add ───────────────────────────────────────────────────
export interface WorktreeAddValue {
  repo: string;
  slug: string;
  branch: string;
  type: "linked" | "worktree";
  path: string;
  isNew: boolean;
}
export function worktreeAddText(v: WorktreeAddValue, _ctx: FormatCtx): string {
  const branchSuffix = v.isNew ? " (new)" : "";
  return `Added worktree '${v.slug}' at ${v.path}\n  branch: ${v.branch}${branchSuffix}`;
}
export function worktreeAddPorcelain(v: WorktreeAddValue): string {
  return `${v.repo}\t${v.slug}\t${v.branch}\t${v.type}\t${v.path}`;
}

// ── ws worktree list ──────────────────────────────────────────────────
export interface WorktreeListItem {
  repo: string;
  slug: string;
  branch: string;
  type: "linked" | "worktree";
}
export function worktreeListText(items: WorktreeListItem[], ctx: FormatCtx): string {
  if (items.length === 0) {
    return "";
  }
  const rows = items.map((w) => [w.repo, w.slug, w.branch, c.dim(w.type, ctx.colorEnabled)]);
  if (ctx.isTTY) {
    const headers = ["REPO", "SLUG", "BRANCH", "TYPE"].map((h) => c.bold(h, ctx.colorEnabled));
    return alignTable(rows, { headers });
  }
  return alignTable(rows);
}
export function worktreeListPorcelain(items: WorktreeListItem[]): string {
  return items.map((w) => `${w.repo}\t${w.slug}\t${w.branch}\t${w.type}`).join("\n");
}

// ── ws worktree remove ────────────────────────────────────────────────
export interface WorktreeRemoveValue {
  repo: string;
  slug: string;
  workspace: string;
}
export function worktreeRemoveText(v: WorktreeRemoveValue, _ctx: FormatCtx): string {
  return `Removed worktree '${v.slug}' for repo '${v.repo}' from workspace '${v.workspace}'`;
}
export function worktreeRemovePorcelain(v: WorktreeRemoveValue): string {
  return `${v.repo}\t${v.slug}\tremoved`;
}

// ── ws worktree prune ─────────────────────────────────────────────────
export interface WorktreePruneValue {
  workspace: string;
  pruned: Array<{ repo: string; slug: string }>;
}
export function worktreePruneText(v: WorktreePruneValue, _ctx: FormatCtx): string {
  if (v.pruned.length === 0) {
    return `Pruned 0 worktrees from workspace '${v.workspace}'`;
  }
  const slugs = v.pruned.map((p) => p.slug).join(", ");
  return `Pruned ${v.pruned.length} worktrees from workspace '${v.workspace}': ${slugs}`;
}
export function worktreePrunePorcelain(v: WorktreePruneValue): string {
  return v.pruned.map((p) => `${p.repo}\t${p.slug}`).join("\n");
}
