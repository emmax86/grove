import { renderTree } from "../tree";
import type { FormatCtx } from "./workspace";

export interface StatusWorktree {
  repo: string;
  slug: string;
  branch: string;
  type: "linked" | "worktree";
}

export interface StatusRepo {
  name: string;
  path: string;
  status: "ok" | "dangling";
  worktrees: StatusWorktree[];
}

export interface StatusValue {
  name: string;
  path: string;
  repos: StatusRepo[];
}

type TreeNode =
  | { kind: "workspace"; name: string; path: string; children: TreeNode[] }
  | { kind: "repo"; name: string; path: string; status: string; children: TreeNode[] }
  | { kind: "worktree"; slug: string; branch: string; type: string };

function toTree(v: StatusValue): TreeNode {
  return {
    kind: "workspace",
    name: v.name,
    path: v.path,
    children: v.repos.map<TreeNode>((r) => ({
      kind: "repo",
      name: r.name,
      path: r.path,
      status: r.status,
      children: r.worktrees.map<TreeNode>((w) => ({
        kind: "worktree",
        slug: w.slug,
        branch: w.branch,
        type: w.type,
      })),
    })),
  };
}

function getChildren(n: TreeNode): TreeNode[] {
  if (n.kind === "worktree") {
    return [];
  }
  return n.children;
}

function label(n: TreeNode): string {
  if (n.kind === "workspace") {
    return `${n.name} (${n.path})`;
  }
  if (n.kind === "repo") {
    return `${n.name} (${n.path}) [${n.status}]`;
  }
  if (n.type === "linked") {
    return `${n.slug} (linked)`;
  }
  return `${n.slug} (worktree, branch: ${n.branch})`;
}

export function statusText(v: StatusValue, ctx: FormatCtx): string {
  return renderTree(toTree(v), getChildren, label, { unicode: ctx.unicodeEnabled });
}

// Porcelain schema: 6 tab-separated fields per row, fixed regardless of content.
// Columns: <repo>\t<repo_path>\t<repo_status>\t<slug>\t<branch>\t<type>
// Repos with no worktrees emit a row with empty trailing fields (slug/branch/type),
// preserving the column count so `awk -F'\t'` works without conditional logic.
export function statusPorcelain(v: StatusValue): string {
  const lines: string[] = [];
  for (const r of v.repos) {
    if (r.worktrees.length === 0) {
      lines.push(`${r.name}\t${r.path}\t${r.status}\t\t\t`);
    } else {
      for (const w of r.worktrees) {
        lines.push(`${r.name}\t${r.path}\t${r.status}\t${w.slug}\t${w.branch}\t${w.type}`);
      }
    }
  }
  return lines.join("\n");
}
