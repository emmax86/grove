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

type RegistryNode = (typeof REGISTRY)["children"][number];

// Mirror the runtime registry walk at the type level so MCP handlers infer
// concrete argument names and values from each binding.
type FindRegistryNode<
  Nodes extends readonly unknown[],
  Path extends readonly string[],
> = Path extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? Extract<Nodes[number], { name: Head }> extends infer Node
    ? Tail extends []
      ? Node
      : Node extends { kind: "group"; children: infer Children extends readonly unknown[] }
        ? FindRegistryNode<Children, Tail>
        : never
    : never
  : never;

type BindingLeaf<B extends McpToolBinding> = Extract<
  FindRegistryNode<readonly RegistryNode[], B["path"]>,
  { kind: "leaf" }
>;
type TupleItem<T> = T extends readonly unknown[] ? T[number] : never;
type BindingOmit<B extends McpToolBinding> = B extends {
  readonly omit: readonly (infer Name extends string)[];
}
  ? Name
  : never;
type BindingOverride<B extends McpToolBinding, Name extends string> = B extends {
  readonly overrides: readonly (infer Override)[];
}
  ? Extract<Override, { name: Name }>
  : never;
type BindingFieldName<B extends McpToolBinding, Name extends string> = [
  BindingOverride<B, Name>,
] extends [never]
  ? CamelCase<Name>
  : BindingOverride<B, Name> extends { as: infer Alias extends string }
    ? Alias
    : CamelCase<Name>;
type BindingRequired<B extends McpToolBinding, Spec extends { name: string; required: boolean }> = [
  BindingOverride<B, Spec["name"]>,
] extends [never]
  ? Spec["required"]
  : BindingOverride<B, Spec["name"]> extends { required: infer Required extends boolean }
    ? Required
    : Spec["required"];
type CamelCase<Name extends string> = Name extends `${infer Head}-${infer Next}${infer Rest}`
  ? `${Head}${Uppercase<Next>}${CamelCase<Rest>}`
  : Name;
type EnumValues<Arg> = Arg extends {
  readonly values: infer Values extends readonly [string, ...string[]];
}
  ? Values[number]
  : string;
type ArgSchema<Arg> = Arg extends { readonly variadic: true }
  ? z.ZodArray<z.ZodString>
  : Arg extends { readonly values: readonly [string, ...string[]] }
    ? z.ZodType<EnumValues<Arg>>
    : z.ZodString;
type FlagSchema<Flag> = Flag extends { readonly valueLabel: string } ? z.ZodString : z.ZodBoolean;
type TypedFieldSpec<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  required: boolean;
  schema: Schema;
};
type ArgSpecs<Leaf> =
  TupleItem<Leaf extends { args: infer Args } ? Args : never> extends infer Arg
    ? Arg extends { name: string; required: boolean }
      ? { name: Arg["name"]; required: Arg["required"]; schema: ArgSchema<Arg> }
      : never
    : never;
type FlagSpecs<Leaf> =
  TupleItem<Leaf extends { flags: infer Flags } ? Flags : never> extends infer Flag
    ? Flag extends { name: string }
      ? { name: Flag["name"]; required: false; schema: FlagSchema<Flag> }
      : never
    : never;
type OptionalWhen<Schema extends z.ZodTypeAny, Required extends boolean> = Required extends true
  ? Schema
  : z.ZodOptional<Schema>;
type FieldShape<B extends McpToolBinding, Spec> = Spec extends TypedFieldSpec
  ? Spec["name"] extends BindingOmit<B>
    ? Record<never, never>
    : {
        [Key in BindingFieldName<B, Spec["name"]>]: OptionalWhen<
          Spec["schema"],
          BindingRequired<B, Spec>
        >;
      }
  : never;
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type Simplify<T> = { [Key in keyof T]: T[Key] };
export type ToolInputShape<B extends McpToolBinding> = Simplify<
  UnionToIntersection<FieldShape<B, ArgSpecs<BindingLeaf<B>> | FlagSpecs<BindingLeaf<B>>>>
>;

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** Walk REGISTRY.children to the leaf at `path`. Throws if missing or not a leaf. */
export function findLeaf(path: readonly string[]): HelpLeaf {
  if (path.length === 0) {
    throw new Error("registry path must not be empty");
  }
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
  const scalar =
    arg.values && arg.values.length > 0
      ? z.enum([...arg.values] as [string, ...string[]])
      : z.string();
  const base = arg.variadic ? z.array(z.string()) : scalar;
  return { name: arg.name, required: arg.required, description: arg.summary, base };
}

function flagSpec(flag: HelpFlag): FieldSpec {
  const base = flag.valueLabel ? z.string() : z.boolean();
  return { name: flag.name, required: false, description: flag.summary, base };
}

/** Derive a zod raw shape (the MCP `inputSchema`) for a tool from the registry. */
export function buildToolInputSchema<const B extends McpToolBinding>(
  binding: B,
): ToolInputShape<B> {
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

  return shape as ToolInputShape<B>;
}

export const WORKTREE_ADD_BINDING = {
  toolName: "workspace_add_worktree",
  path: ["ws", "worktree", "add"],
  omit: ["workspace"],
  overrides: [
    { name: "repo", required: true },
    { name: "new", as: "newBranch" },
  ],
} as const satisfies McpToolBinding;

export const WORKTREE_REMOVE_BINDING = {
  toolName: "workspace_remove_worktree",
  path: ["ws", "worktree", "remove"],
  omit: ["workspace"],
  overrides: [{ name: "repo", required: true }],
} as const satisfies McpToolBinding;

export const EXEC_BINDING = {
  toolName: "workspace_exec",
  path: ["ws", "exec"],
  omit: ["workspace"],
} as const satisfies McpToolBinding;

export const MCP_TOOL_BINDINGS: readonly McpToolBinding[] = [
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
  EXEC_BINDING,
];
