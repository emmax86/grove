import type {
  ContextIndexEntry,
  ContextInstructionSource,
  GroveContext,
  TargetContext,
  TouchEntry,
  WorkspaceContext,
} from "../../../commands/context";
import type { ContextSessionsValue } from "../../../commands/context-client";
import type { FormatCtx } from "./workspace";

export type GroveContextValue = GroveContext;

function worktreeLabel(worktree: WorkspaceContext["worktrees"][number]): string {
  const branch = worktree.branch ? ` ${worktree.branch}` : "";
  return `- ${worktree.repo}/${worktree.slug} ${worktree.type}${branch} ${worktree.path}`;
}

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 8);
}

function groupedIndexEntries(
  index: ContextIndexEntry[],
): { primary: ContextIndexEntry; duplicates: ContextIndexEntry[] }[] {
  const groups: { primary: ContextIndexEntry; duplicates: ContextIndexEntry[] }[] = [];
  const byHash = new Map<string, (typeof groups)[number]>();

  for (const entry of index) {
    const existing = byHash.get(entry.contentHash);
    if (existing) {
      existing.duplicates.push(entry);
      continue;
    }

    const group = { primary: entry, duplicates: [] };
    groups.push(group);
    byHash.set(entry.contentHash, group);
  }

  return groups;
}

function duplicateCount(groups: ReturnType<typeof groupedIndexEntries>): number {
  return groups.reduce((count, group) => count + group.duplicates.length, 0);
}

function compactIndexLabel(group: ReturnType<typeof groupedIndexEntries>[number]): string {
  const entry = group.primary;
  const lines = [
    `- ${entry.scope} ${entry.kind} h:${shortHash(entry.contentHash)} load: ${entry.scopePath}`,
  ];

  if (group.duplicates.length > 0) {
    lines.push(`  same: ${group.duplicates.map((duplicate) => duplicate.scopePath).join(", ")}`);
  }

  return lines.join("\n");
}

function compactSkippedSection(skipped: GroveContext["skipped"]): string[] {
  if (skipped.length === 0) {
    return [];
  }
  return [
    `Skipped (${skipped.length})`,
    ...skipped.map((entry) => `- ${entry.path} - ${entry.reason}`),
  ];
}

function markdownSkippedSection(skipped: GroveContext["skipped"]): string[] {
  if (skipped.length === 0) {
    return [];
  }
  return ["## Skipped", ...skipped.map((entry) => `- ${entry.path} - ${entry.reason}`)];
}

function workspaceText(value: WorkspaceContext): string {
  const groupedIndex = groupedIndexEntries(value.index);
  const duplicates = duplicateCount(groupedIndex);
  const lines = [
    "# Grove Context",
    "",
    `workspace ${value.workspace.name} ${value.workspace.path}`,
    `hash ${shortHash(value.graph.root)}`,
    "",
    "Protocol: run `grove ws context <target>` before working in a repo/worktree.",
  ];

  if (value.workspaceInstructions) {
    lines.push(
      "",
      "Workspace instruction",
      `- ${value.workspaceInstructions.path} h:${shortHash(value.workspaceInstructions.contentHash)}`,
    );
  }

  lines.push("", `Worktrees (${value.worktrees.length})`);

  if (value.worktrees.length === 0) {
    lines.push("none");
  } else {
    lines.push(...value.worktrees.map(worktreeLabel));
  }

  lines.push(
    "",
    `Instructions (${groupedIndex.length} unique, ${duplicates} duplicate${duplicates === 1 ? "" : "s"})`,
  );
  if (groupedIndex.length === 0) {
    lines.push("none");
  } else {
    lines.push(...groupedIndex.map(compactIndexLabel));
  }

  const skipped = compactSkippedSection(value.skipped);
  if (skipped.length > 0) {
    lines.push("", ...skipped);
  }

  return lines.join("\n");
}

function sourceSection(source: ContextInstructionSource): string {
  return [`### ${source.path} @${shortHash(source.contentHash)}`, "", source.content].join("\n");
}

function targetText(value: TargetContext): string {
  const lines = [
    "# Grove Context",
    "",
    `Workspace: ${value.workspace.name}`,
    `Original target: ${value.target}`,
    `Resolved worktree: ${value.repo}/${value.slug}`,
    `Loaded scope: ${value.loadedScope}`,
    `Context key: ${value.contextKey}`,
    `Context hash: ${shortHash(value.contextHash)}`,
    "",
    "## Agent Protocol",
    "Prefer the context_touch MCP tool (or `grove ws context touch <paths>`) for incremental loading; it only re-sends what changed.",
    "",
    "## Loaded Instructions",
  ];

  if (value.sources.length === 0) {
    lines.push("No instruction files found for this target.");
  } else {
    lines.push(...value.sources.map(sourceSection));
  }

  const skipped = markdownSkippedSection(value.skipped);
  if (skipped.length > 0) {
    lines.push("", ...skipped);
  }

  return lines.join("\n");
}

function touchMarkerLine(entry: TouchEntry): string {
  const base = `- ${entry.status} ${entry.contextKey}@${shortHash(entry.contentHash)}`;
  return entry.status === "updated" ? `${base} (superseded earlier version)` : base;
}

function touchText(value: Extract<GroveContextValue, { mode: "touch" }>): string {
  const markers = value.entries.filter((e) => e.status === "current" || e.status === "updated");
  const withContent = value.entries.filter((e) => e.content !== undefined);
  const lines = ["# Grove Context Touch"];

  if (markers.length > 0) {
    lines.push("", ...markers.map(touchMarkerLine));
  }

  for (const entry of withContent) {
    lines.push(
      "",
      `## ${entry.sourcePath} @${shortHash(entry.contentHash)}`,
      "",
      entry.content ?? "",
    );
  }

  if (value.entries.length === 0) {
    lines.push("", "No instruction scopes for the given paths.");
  }

  const skipped = markdownSkippedSection(value.skipped);
  if (skipped.length > 0) {
    lines.push("", ...skipped);
  }

  return lines.join("\n");
}

export function contextText(value: GroveContextValue, _ctx: FormatCtx): string {
  if (value.mode === "workspace") {
    return workspaceText(value);
  }
  if (value.mode === "touch") {
    return touchText(value);
  }
  return targetText(value);
}

function instructionRow(
  rowType: "index" | "source",
  workspace: string,
  entry: ContextIndexEntry,
): string {
  // Keep hash before contentHash for existing porcelain consumers; today it is a compat alias.
  return [
    rowType,
    workspace,
    entry.repo,
    entry.slug,
    entry.scope,
    entry.sourcePath,
    entry.kind,
    entry.hash,
    entry.contextKey,
    entry.layer,
    entry.ownership,
    entry.selectionReason,
    entry.contentHash,
  ].join("\t");
}

function touchPorcelain(value: Extract<GroveContextValue, { mode: "touch" }>): string {
  return value.entries
    .map((entry) =>
      [
        "touch",
        value.workspace.name,
        entry.contextKey,
        entry.status,
        entry.contentHash,
        entry.sourcePath,
      ].join("\t"),
    )
    .join("\n");
}

export function contextPorcelain(value: GroveContextValue): string {
  if (value.mode === "workspace") {
    const rows = [
      ...(value.workspaceInstructions
        ? [instructionRow("source", value.workspace.name, value.workspaceInstructions)]
        : []),
      ...value.index.map((entry) => instructionRow("index", value.workspace.name, entry)),
    ];
    return rows.join("\n");
  }

  if (value.mode === "touch") {
    return touchPorcelain(value);
  }

  const targetRow = [
    "target",
    value.workspace.name,
    value.repo,
    value.slug,
    value.loadedScope.replace(/^trees\//, ""),
    value.worktreePath,
    value.contextKey,
    value.contextHash,
  ].join("\t");
  const sourceRows = value.sources.map((source) =>
    instructionRow("source", value.workspace.name, source),
  );

  return [targetRow, ...sourceRows].join("\n");
}

export function contextSessionsText(value: ContextSessionsValue): string {
  const lines = ["# Grove Context Sessions"];

  if (value.sessions.length === 0) {
    lines.push("", "none");
    return lines.join("\n");
  }

  for (const entry of value.sessions) {
    lines.push("", `## ${entry.session}`);
    if (entry.scopes.length === 0) {
      lines.push("none");
    } else {
      lines.push(
        ...entry.scopes.map((scope) => `- ${scope.contextKey}@${shortHash(scope.contentHash)}`),
      );
    }
  }

  return lines.join("\n");
}

export function contextSessionsPorcelain(value: ContextSessionsValue): string {
  return value.sessions
    .flatMap((entry) =>
      entry.scopes.map((scope) =>
        ["session", value.workspace, entry.session, scope.contextKey, scope.contentHash].join("\t"),
      ),
    )
    .join("\n");
}
