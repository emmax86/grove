import type { Result } from "../../types";
import type { HelpView } from "../render/formatters/help";
import type { HelpGroup, HelpNode } from "./registry";
import { GLOBAL_FLAGS, REGISTRY } from "./registry";

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

export function isHelpRequested(argv: readonly string[], registry: HelpGroup): boolean {
  // --help / -h: unambiguous, anywhere in argv
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) {
      return true;
    }
  }
  // Positional "help": only when it's at a command-slot position (a group, not after a leaf or an unmatched token)
  const positionals = stripFlags(argv);
  const helpIndex = positionals.indexOf(HELP_POSITIONAL);
  if (helpIndex === -1) {
    return false;
  }
  // Walk tokens before "help" against the registry. If we reach a leaf or hit an unmatched token, "help" is an arg.
  let node: HelpNode = registry;
  for (const token of positionals.slice(0, helpIndex)) {
    if (node.kind !== "group") {
      return false; // hit a leaf before reaching help
    }
    const child: HelpNode | undefined = node.children.find(
      (c) => c.name === token || (c.aliases?.includes(token) ?? false),
    );
    if (!child) {
      return false; // unmatched token before help
    }
    node = child;
  }
  return node.kind === "group";
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

/** A `Result<T>` error variant pinned to MISSING_ARG with a required help view. */
export type MissingArgPayload = Extract<Result<never>, { ok: false }> & {
  code: "MISSING_ARG";
  help: HelpView;
};

export function buildMissingArgPayload(
  argName: string,
  commandPath: readonly string[],
  registry: HelpGroup = REGISTRY,
): MissingArgPayload {
  const result = resolveCommandPath(commandPath, registry);
  return {
    ok: false,
    code: "MISSING_ARG",
    error: `missing required argument: ${argName}`,
    help: {
      path: result.path,
      node: result.node,
      globalFlags: GLOBAL_FLAGS,
    },
  };
}
