import type { Result } from "../../types";
import type { HelpView } from "../render/formatters/help";
import type { HelpFlag, HelpGroup, HelpNode } from "./registry";
import { GLOBAL_FLAGS, REGISTRY } from "./registry";

const HELP_FLAGS = new Set(["--help", "-h"]);
const HELP_POSITIONAL = "help";

/**
 * Per-registry cache of value-taking flag names (those with a `valueLabel`).
 * Avoids re-walking the registry tree on every dispatch call.
 */
const valueTakingFlagsCache = new WeakMap<HelpGroup, ReadonlySet<string>>();

function valueTakingFlags(registry: HelpGroup): ReadonlySet<string> {
  let cached = valueTakingFlagsCache.get(registry);
  if (cached === undefined) {
    cached = collectValueTakingFlags(registry);
    valueTakingFlagsCache.set(registry, cached);
  }
  return cached;
}

function collectValueTakingFlags(registry: HelpGroup): Set<string> {
  const out = new Set<string>();
  for (const f of GLOBAL_FLAGS) {
    if (f.valueLabel !== undefined) {
      out.add(f.name);
    }
  }
  function walk(node: HelpNode): void {
    if (node.kind === "leaf") {
      for (const f of node.flags ?? []) {
        if ((f as HelpFlag).valueLabel !== undefined) {
          out.add(f.name);
        }
      }
    } else {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(registry);
  return out;
}

/**
 * Strip flag tokens from argv, returning only positional arguments.
 * `--help` and `-h` are boolean flags so they never consume the next token.
 * `--flag` tokens consume the next token only if `flag` has a `valueLabel`
 * in the supplied registry. Boolean flags like `--json`, `--porcelain`, `--force`
 * never consume the next token, even if it doesn't start with `--`.
 */
function stripFlags(argv: readonly string[], registry: HelpGroup): string[] {
  const valueFlags = valueTakingFlags(registry);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (HELP_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2).split("=")[0];
      const inlineValue = arg.includes("=");
      if (!inlineValue && valueFlags.has(flagName)) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          i++;
        }
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
  const positionals = stripFlags(argv, registry);
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
  const positionals = stripFlags(argv, registry).filter((a) => a !== HELP_POSITIONAL);

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
