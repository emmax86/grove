import { c } from "../color";
import { alignTable } from "../columns";

export interface FormatCtx {
  colorEnabled: boolean;
  unicodeEnabled: boolean;
  isTTY: boolean;
}

// ── ws add ────────────────────────────────────────────────────────────
export interface WorkspaceAddValue {
  name: string;
  path: string;
}
export function workspaceAddText(v: WorkspaceAddValue, _ctx: FormatCtx): string {
  return `Created workspace '${v.name}' at ${v.path}`;
}
export function workspaceAddPorcelain(v: WorkspaceAddValue): string {
  return `${v.name}\tcreated\t${v.path}`;
}

// ── ws list ───────────────────────────────────────────────────────────
export interface WorkspaceListItem {
  name: string;
  path: string;
}
export function workspaceListText(items: WorkspaceListItem[], ctx: FormatCtx): string {
  if (items.length === 0) {
    return "";
  }
  const rows = items.map((w) => [w.name, w.path]);
  if (ctx.isTTY) {
    const headers = [c.bold("NAME", ctx.colorEnabled), c.bold("PATH", ctx.colorEnabled)];
    return alignTable(rows, { headers });
  }
  return alignTable(rows);
}
export function workspaceListPorcelain(items: WorkspaceListItem[]): string {
  return items.map((w) => `${w.name}\t${w.path}`).join("\n");
}

// ── ws remove ─────────────────────────────────────────────────────────
export interface WorkspaceRemoveValue {
  name: string;
}
export function workspaceRemoveText(v: WorkspaceRemoveValue, _ctx: FormatCtx): string {
  return `Removed workspace '${v.name}'`;
}
export function workspaceRemovePorcelain(v: WorkspaceRemoveValue): string {
  return `${v.name}\tremoved`;
}

// ── ws path ───────────────────────────────────────────────────────────
export interface WorkspacePathValue {
  path: string;
}
export function workspacePathText(v: WorkspacePathValue, _ctx: FormatCtx): string {
  return v.path;
}
export function workspacePathPorcelain(v: WorkspacePathValue): string {
  return v.path;
}

// ── ws sync ───────────────────────────────────────────────────────────
export interface WorkspaceSyncValue {
  name: string;
  repos: Array<{ name: string; status: "ok" | "repaired" | "dangling" }>;
}
export function workspaceSyncText(v: WorkspaceSyncValue, _ctx: FormatCtx): string {
  const ok = v.repos.filter((r) => r.status === "ok");
  const repaired = v.repos.filter((r) => r.status === "repaired");
  const dangling = v.repos.filter((r) => r.status === "dangling");

  const parts: string[] = [];
  if (ok.length > 0) {
    parts.push(`${ok.length} ok`);
  }
  if (repaired.length > 0) {
    parts.push(`${repaired.length} repaired (${repaired.map((r) => r.name).join(", ")})`);
  }
  if (dangling.length > 0) {
    parts.push(`${dangling.length} dangling (${dangling.map((r) => r.name).join(", ")})`);
  }

  return `Synced workspace '${v.name}': ${parts.join(", ")}`;
}
export function workspaceSyncPorcelain(v: WorkspaceSyncValue): string {
  return v.repos.map((r) => `${v.name}\t${r.name}\t${r.status}`).join("\n");
}
