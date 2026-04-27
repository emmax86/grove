import type { HelpGroup, HelpNode } from "./registry";

const HELP_FLAGS = new Set(["--help", "-h"]);
const HELP_POSITIONAL = "help";

/**
 * Strip flag tokens from argv, returning only positional arguments.
 * `--help` and `-h` are boolean flags so they never consume the next token.
 * Other `--flag` tokens consume the next token as a value if it doesn't start with `--`.
 * Single-dash short flags besides `-h` are not currently produced by the grove CLI;
 * if encountered, they are treated as positionals (acceptable since grove has no short flags besides `-h`).
 */
function stripFlags(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (HELP_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        i++;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}

export function isHelpRequested(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) {
      return true;
    }
  }
  return stripFlags(argv).includes(HELP_POSITIONAL);
}

export interface ResolveResult {
  /** Breadcrumb path including root: ["grove", "ws", "repo", "add"]. */
  path: string[];
  /** Deepest matched node. */
  node: HelpNode;
  /** Trailing tokens that did not match any child. */
  unmatched: string[];
}

export function resolveCommandPath(argv: readonly string[], registry: HelpGroup): ResolveResult {
  const positionals = stripFlags(argv).filter((a) => a !== HELP_POSITIONAL);

  let node: HelpNode = registry;
  const path: string[] = [registry.name];
  let i = 0;
  for (; i < positionals.length; i++) {
    if (node.kind !== "group") {
      break;
    }
    const token = positionals[i];
    const child: HelpNode | undefined = node.children.find(
      (c) => c.name === token || (c.aliases?.includes(token) ?? false),
    );
    if (!child) {
      break;
    }
    path.push(child.name);
    node = child;
  }
  return { path, node, unmatched: positionals.slice(i) };
}
