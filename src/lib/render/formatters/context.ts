import type {
  ContextIndexEntry,
  ContextInstructionSource,
  GroveContext,
  TargetContext,
  WorkspaceContext,
} from "../../../commands/context";
import type { FormatCtx } from "./workspace";

export type GroveContextValue = GroveContext;

function worktreeLabel(worktree: WorkspaceContext["worktrees"][number]): string {
  const details = worktree.branch ? `${worktree.type}, branch: ${worktree.branch}` : worktree.type;
  return `- ${worktree.repo}/${worktree.slug} (${details}) - ${worktree.path}`;
}

function indexLabel(entry: ContextIndexEntry): string {
  return [
    `- ${entry.scope}`,
    `  source: ${entry.sourcePath}`,
    `  kind: ${entry.kind}`,
    `  layer: ${entry.layer}`,
    `  ownership: ${entry.ownership}`,
    `  selection reason: ${entry.selectionReason}`,
    `  source/content hash: ${entry.contentHash}`,
    `  context key: ${entry.contextKey}`,
    `  load: ${entry.loadCommand}`,
  ].join("\n");
}

function skippedSection(skipped: GroveContext["skipped"]): string[] {
  if (skipped.length === 0) {
    return [];
  }
  return ["## Skipped", ...skipped.map((entry) => `- ${entry.path} - ${entry.reason}`)];
}

function workspaceText(value: WorkspaceContext): string {
  const lines = [
    "# Grove Context",
    "",
    `Workspace: ${value.workspace.name}`,
    `Path: ${value.workspace.path}`,
    `Context hash: ${value.graph.root}`,
    "",
    "## Agent Protocol",
    "Use `grove ws context <target>` to load instructions for a specific workspace path.",
  ];

  if (value.workspaceInstructions) {
    lines.push("", "## Workspace Instructions", sourceSection(value.workspaceInstructions));
  }

  lines.push("", "## Worktrees");

  if (value.worktrees.length === 0) {
    lines.push("No worktrees found.");
  } else {
    lines.push(...value.worktrees.map(worktreeLabel));
  }

  lines.push("", "## Instruction Index");
  if (value.index.length === 0) {
    lines.push("No instruction files were found under workspace worktrees.");
  } else {
    lines.push(...value.index.map(indexLabel));
  }

  const skipped = skippedSection(value.skipped);
  if (skipped.length > 0) {
    lines.push("", ...skipped);
  }

  return lines.join("\n");
}

function sourceSection(source: ContextInstructionSource): string {
  return [
    `### ${source.path}`,
    `Kind: ${source.kind}`,
    `Layer: ${source.layer}`,
    `Ownership: ${source.ownership}`,
    `Selection reason: ${source.selectionReason}`,
    `Source/content hash: ${source.contentHash}`,
    "",
    source.content,
  ].join("\n");
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
    `Context hash: ${value.contextHash}`,
    "",
    "## Agent Protocol",
    `Reload with \`grove ws context ${value.workspace.name} ${value.loadedScope}\` when instructions may have changed.`,
    "",
    "## Loaded Instructions",
  ];

  if (value.sources.length === 0) {
    lines.push("No instruction files found for this target.");
  } else {
    lines.push(...value.sources.map(sourceSection));
  }

  const skipped = skippedSection(value.skipped);
  if (skipped.length > 0) {
    lines.push("", ...skipped);
  }

  return lines.join("\n");
}

export function contextText(value: GroveContextValue, _ctx: FormatCtx): string {
  return value.mode === "workspace" ? workspaceText(value) : targetText(value);
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
