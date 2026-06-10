import { z } from "zod";

import { type HelpArg, type HelpFlag, type HelpLeaf, type HelpNode, REGISTRY } from "./registry";

/** Per-field MCP delta over the registry node. */
export interface McpFieldOverride {
  /** Registry arg/flag name. */
  name: string;
  /** MCP field name (default: camelCase of `name`). */
  as?: string;
  /** Force required-ness (default: arg.required for args, false for flags). */
  required?: boolean;
}

/** Maps one MCP tool to a registry leaf plus MCP-specific deltas. */
export interface McpToolBinding {
  toolName: string;
  /** Path of node names under REGISTRY.children, e.g. ["ws", "worktree", "add"]. */
  path: readonly string[];
  /** Registry arg/flag names intentionally excluded from the MCP tool. */
  omit?: readonly string[];
  overrides?: readonly McpFieldOverride[];
}

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** Walk REGISTRY.children to the leaf at `path`. Throws if missing or not a leaf. */
export function findLeaf(path: readonly string[]): HelpLeaf {
  let nodes: readonly HelpNode[] = REGISTRY.children;
  let node: HelpNode | undefined;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    node = nodes.find((n) => n.name === segment);
    if (!node) {
      throw new Error(`registry path not found: ${path.join(" ")} (missing "${segment}")`);
    }
    if (node.kind === "group") {
      nodes = node.children;
    } else if (i < path.length - 1) {
      throw new Error(`registry path is not a leaf: ${path.join(" ")}`);
    }
  }
  if (node?.kind !== "leaf") {
    throw new Error(`registry path is not a leaf: ${path.join(" ")}`);
  }
  return node;
}

interface FieldSpec {
  name: string;
  required: boolean;
  description?: string;
  base: z.ZodTypeAny;
}

function argSpec(arg: HelpArg): FieldSpec {
  const base = arg.values ? z.enum([...arg.values] as [string, ...string[]]) : z.string();
  return { name: arg.name, required: arg.required, description: arg.summary, base };
}

function flagSpec(flag: HelpFlag): FieldSpec {
  const base = flag.valueLabel ? z.string() : z.boolean();
  return { name: flag.name, required: false, description: flag.summary, base };
}

/** Derive a zod raw shape (the MCP `inputSchema`) for a tool from the registry. */
export function buildToolInputSchema(binding: McpToolBinding): z.ZodRawShape {
  const leaf = findLeaf(binding.path);
  const omit = new Set(binding.omit ?? []);
  const overrides = new Map((binding.overrides ?? []).map((o) => [o.name, o]));
  const shape: Record<string, z.ZodTypeAny> = {};

  const specs: FieldSpec[] = [
    ...(leaf.args ?? []).map(argSpec),
    ...(leaf.flags ?? []).map(flagSpec),
  ];

  for (const spec of specs) {
    if (omit.has(spec.name)) {
      continue;
    }
    const override = overrides.get(spec.name);
    const mcpName = override?.as ?? camelCase(spec.name);
    const required = override?.required ?? spec.required;
    let field: z.ZodTypeAny = spec.description ? spec.base.describe(spec.description) : spec.base;
    if (!required) {
      field = field.optional();
    }
    shape[mcpName] = field;
  }

  return shape;
}

export const WORKTREE_ADD_BINDING: McpToolBinding = {
  toolName: "workspace_add_worktree",
  path: ["ws", "worktree", "add"],
  omit: ["workspace"],
  overrides: [
    { name: "repo", required: true },
    { name: "new", as: "newBranch" },
  ],
};

export const WORKTREE_REMOVE_BINDING: McpToolBinding = {
  toolName: "workspace_remove_worktree",
  path: ["ws", "worktree", "remove"],
  omit: ["workspace"],
  overrides: [{ name: "repo", required: true }],
};

export const EXEC_BINDING: McpToolBinding = {
  toolName: "workspace_exec",
  path: ["ws", "exec"],
  omit: ["workspace"],
};

export const MCP_TOOL_BINDINGS: readonly McpToolBinding[] = [
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
  EXEC_BINDING,
];
