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
    "",
    "## Agent Protocol",
    "Use `grove ws context <target>` to load instructions for a specific workspace path.",
    "",
    "## Worktrees",
  ];

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
    `Source hash: ${source.hash}`,
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
    `Reload with \`grove ws context ${value.loadedScope}\` when instructions may have changed.`,
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

export function contextPorcelain(value: GroveContextValue): string {
  if (value.mode === "workspace") {
    return value.index
      .map((entry) =>
        [
          "index",
          value.workspace.name,
          entry.repo,
          entry.slug,
          entry.scope,
          entry.sourcePath,
          entry.kind,
          entry.hash,
          entry.contextKey,
        ].join("\t"),
      )
      .join("\n");
  }

  const targetRow = [
    "target",
    value.workspace.name,
    value.repo,
    value.slug,
    value.loadedScope,
    value.worktreePath,
    value.contextKey,
    value.contextHash,
  ].join("\t");
  const sourceRows = value.sources.map((source) =>
    [
      "source",
      value.workspace.name,
      source.repo,
      source.slug,
      source.scope,
      source.sourcePath,
      source.kind,
      source.hash,
      source.contextKey,
    ].join("\t"),
  );

  return [targetRow, ...sourceRows].join("\n");
}
