import type { HelpFlag, HelpLeaf, HelpNode } from "../../help/registry";
import { bold, cyan, dim, yellow } from "../color";

export interface HelpView {
  path: readonly string[];
  node: HelpNode;
  globalFlags: readonly HelpFlag[];
  /** Optional note rendered as a yellow first line (used for typo cases). */
  note?: string;
}

interface FormatterCtx {
  colorEnabled: boolean;
  unicodeEnabled: boolean;
}

export function helpText(view: HelpView, ctx: FormatterCtx): string {
  const lines: string[] = [];

  if (view.note) {
    lines.push(yellow(`note: ${view.note}`, ctx.colorEnabled));
    lines.push("");
  }

  const dash = ctx.unicodeEnabled ? "—" : "--";
  const pathStr = view.path.join(" ");
  lines.push(bold(`${pathStr} ${dash} ${view.node.summary}`, ctx.colorEnabled));

  if (view.node.aliases && view.node.aliases.length > 0) {
    lines.push(`aliases: ${view.node.aliases.join(", ")}`);
  }

  if (view.node.description) {
    lines.push("");
    lines.push(view.node.description);
  }

  if (view.node.kind === "group") {
    appendGroupBody(lines, view, ctx);
  } else {
    appendLeafBody(lines, view, view.node, ctx);
  }

  const isRoot = view.path.length === 1;
  appendGlobalFlags(lines, view.globalFlags, isRoot, ctx);
  appendFooter(lines, view, ctx);

  return lines.join("\n");
}

function appendGroupBody(lines: string[], view: HelpView, ctx: FormatterCtx): void {
  if (view.node.kind !== "group") {
    return;
  }

  lines.push("");
  lines.push(bold("Usage:", ctx.colorEnabled));
  const isRoot = view.path.length === 1;
  const usagePath = view.path.join(" ");
  if (isRoot) {
    lines.push(`  ${usagePath} <command> [args] [flags]`);
  } else {
    lines.push(`  ${usagePath} <subcommand> [args] [flags]`);
  }

  lines.push("");
  lines.push(bold(isRoot ? "Commands:" : "Subcommands:", ctx.colorEnabled));
  const childRows = view.node.children.map((c) => {
    const aliasNote =
      c.aliases && c.aliases.length > 0
        ? dim(`(alias: ${c.aliases.join(", ")})`, ctx.colorEnabled)
        : "";
    return [c.name, c.summary, aliasNote] as const;
  });
  const colWidth = Math.max(2, ...childRows.map((r) => r[0].length)) + 2;
  for (const [name, summary, alias] of childRows) {
    const padded = name.padEnd(colWidth, " ");
    const trailing = alias ? `   ${alias}` : "";
    lines.push(`  ${cyan(padded, ctx.colorEnabled)}${summary}${trailing}`);
  }
}

function appendLeafBody(lines: string[], view: HelpView, leaf: HelpLeaf, ctx: FormatterCtx): void {
  lines.push("");
  lines.push(bold("Usage:", ctx.colorEnabled));
  const argsToken = (leaf.args ?? [])
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(" ");
  const flagsToken = (leaf.flags ?? []).length > 0 ? "[flags]" : "";
  const usageParts = [view.path.join(" "), argsToken, flagsToken].filter(Boolean);
  lines.push(`  ${usageParts.join(" ")}`);

  if (leaf.args && leaf.args.length > 0) {
    lines.push("");
    lines.push(bold("Arguments:", ctx.colorEnabled));
    const labels = leaf.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
    const colWidth = Math.max(...labels.map((l) => l.length)) + 2;
    for (let i = 0; i < leaf.args.length; i++) {
      const a = leaf.args[i];
      const label = labels[i].padEnd(colWidth, " ");
      const summary = a.summary ?? "";
      const fallback =
        a.defaultFrom === "context-workspace"
          ? dim(" (defaults to inferred workspace)", ctx.colorEnabled)
          : a.defaultFrom === "context-repo"
            ? dim(" (defaults to inferred repo)", ctx.colorEnabled)
            : "";
      lines.push(`  ${cyan(label, ctx.colorEnabled)}${summary}${fallback}`);
    }
  }

  if (leaf.flags && leaf.flags.length > 0) {
    lines.push("");
    lines.push(bold("Flags:", ctx.colorEnabled));
    const labels = leaf.flags.map((f) => formatFlagLabel(f));
    const colWidth = Math.max(...labels.map((l) => l.length)) + 2;
    for (let i = 0; i < leaf.flags.length; i++) {
      const f = leaf.flags[i];
      const label = labels[i].padEnd(colWidth, " ");
      const env = f.envVar ? dim(` (also $${f.envVar})`, ctx.colorEnabled) : "";
      lines.push(`  ${cyan(label, ctx.colorEnabled)}${f.summary}${env}`);
    }
  }

  if (leaf.examples && leaf.examples.length > 0) {
    lines.push("");
    lines.push(bold("Examples:", ctx.colorEnabled));
    for (const ex of leaf.examples) {
      if (ex.description) {
        lines.push(`  ${ex.description}`);
      }
      lines.push(`  $ ${ex.command}`);
      lines.push("");
    }
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
  }
}

export function helpPorcelain(view: HelpView): string {
  const rows: string[] = [];
  walkPorcelain(view.node, view.path.slice(0, -1), rows);
  return rows.join("\n");
}

function walkPorcelain(node: HelpNode, parentPath: readonly string[], rows: string[]): void {
  const here = [...parentPath, node.name];
  rows.push(`${here.join(" ")}\t${node.kind}\t${node.summary}`);
  if (node.kind === "group") {
    for (const child of node.children) {
      walkPorcelain(child, here, rows);
    }
  }
}

function formatFlagLabel(flag: HelpFlag): string {
  return flag.valueLabel ? `--${flag.name} ${flag.valueLabel}` : `--${flag.name}`;
}

function appendGlobalFlags(
  lines: string[],
  flags: readonly HelpFlag[],
  isRoot: boolean,
  ctx: FormatterCtx,
): void {
  if (flags.length === 0) {
    return;
  }
  lines.push("");
  lines.push(bold("Global flags:", ctx.colorEnabled));
  if (isRoot) {
    const labels = flags.map((f) => `--${f.name}`);
    const colWidth = Math.max(...labels.map((l) => l.length)) + 2;
    for (let i = 0; i < flags.length; i++) {
      const label = labels[i].padEnd(colWidth, " ");
      lines.push(`  ${cyan(label, ctx.colorEnabled)}${flags[i].summary}`);
    }
  } else {
    lines.push(`  ${flags.map((f) => `--${f.name}`).join(", ")}`);
  }
}

function appendFooter(lines: string[], view: HelpView, ctx: FormatterCtx): void {
  const isRoot = view.path.length === 1;
  if (view.node.kind === "group") {
    lines.push("");
    if (isRoot) {
      lines.push("Run `grove <command> --help` for details on a subcommand.");
      lines.push(
        dim("Workspace root: $GROVE_ROOT (default ~/grove-workspaces).", ctx.colorEnabled),
      );
    } else {
      const path = view.path.join(" ");
      lines.push(`Run \`${path} <subcommand> --help\` for details.`);
    }
  }
}
