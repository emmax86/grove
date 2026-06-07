import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
  buildToolInputSchema,
  EXEC_BINDING,
  findLeaf,
  MCP_TOOL_BINDINGS,
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
} from "../lib/help/mcp-schema";
import { type HelpLeaf, type HelpNode, REGISTRY } from "../lib/help/registry";

function leaf(...path: string[]): HelpLeaf {
  let nodes: readonly HelpNode[] = REGISTRY.children;
  let node: HelpNode | undefined;
  for (const segment of path) {
    node = nodes.find((n) => n.name === segment);
    if (!node) {
      throw new Error(`not found: ${path.join(" ")}`);
    }
    if (node.kind === "group") {
      nodes = node.children;
    }
  }
  if (!node || node.kind !== "leaf") {
    throw new Error(`not a leaf: ${path.join(" ")}`);
  }
  return node;
}

describe("registry enum/summary data for MCP", () => {
  it("ws exec command arg carries structured enum values", () => {
    const command = leaf("ws", "exec").args?.find((a) => a.name === "command");
    expect(command?.values).toEqual([
      "setup",
      "format",
      "test",
      "check",
      "test:file",
      "test:match",
    ]);
  });

  it("worktree add/remove repo args have a summary (for the MCP field description)", () => {
    const add = leaf("ws", "worktree", "add").args?.find((a) => a.name === "repo");
    const remove = leaf("ws", "worktree", "remove").args?.find((a) => a.name === "repo");
    expect(add?.summary).toBe("registered repo name");
    expect(remove?.summary).toBe("registered repo name");
  });
});

describe("MCP binding drift guard", () => {
  it("every bound leaf's args/flags are either mapped or explicitly omitted", () => {
    for (const binding of MCP_TOOL_BINDINGS) {
      const leaf = findLeaf(binding.path);
      const registryNames = [
        ...(leaf.args ?? []).map((a) => a.name),
        ...(leaf.flags ?? []).map((f) => f.name),
      ];
      const omitted = new Set(binding.omit ?? []);
      const overridden = new Set((binding.overrides ?? []).map((o) => o.name));
      // A name is "covered" if it's omitted, overridden, or present in the registry leaf
      // (all leaf names flow into the shape unless omitted). The guard's job is to fail
      // when a NEW name appears that the binding author hasn't consciously handled.
      const uncovered = registryNames.filter(
        (n) =>
          !omitted.has(n) && !overridden.has(n) && !KNOWN_PASSTHROUGH[binding.toolName]?.has(n),
      );
      expect({ tool: binding.toolName, uncovered }).toEqual({
        tool: binding.toolName,
        uncovered: [],
      });
    }
  });
});

// Registry names a binding passes through verbatim (no override, not omitted).
// Updating a binding's surface? Update this set in the same change — that is the
// conscious decision the guard is forcing.
const KNOWN_PASSTHROUGH: Record<string, Set<string>> = {
  workspace_add_worktree: new Set(["branch", "from", "no-setup"]),
  workspace_remove_worktree: new Set(["slug", "force"]),
  workspace_exec: new Set(["command", "file", "match", "repo", "dry-run"]),
};

describe("findLeaf", () => {
  it("throws when a path continues past a leaf", () => {
    expect(() => findLeaf(["ws", "exec", "worktree", "add"])).toThrow();
  });
});

describe("buildToolInputSchema", () => {
  it("workspace_add_worktree: fields, rename, required-flip, omit", () => {
    const shape = buildToolInputSchema(WORKTREE_ADD_BINDING);
    expect(Object.keys(shape).sort()).toEqual(
      ["branch", "from", "newBranch", "noSetup", "repo"].sort(),
    );
    expect(Object.keys(shape)).not.toContain("workspace");
    expect(Object.keys(shape)).not.toContain("new");

    const schema = z.object(shape);
    expect(schema.parse({ repo: "r", branch: "b" })).toEqual({ repo: "r", branch: "b" });
    expect(() => schema.parse({ branch: "b" })).toThrow();
    const full = schema.parse({
      repo: "r",
      branch: "b",
      newBranch: true,
      from: "main",
      noSetup: true,
    });
    expect(full).toMatchObject({ newBranch: true, from: "main", noSetup: true });
  });

  it("workspace_remove_worktree: repo required, slug required, force optional", () => {
    const shape = buildToolInputSchema(WORKTREE_REMOVE_BINDING);
    expect(Object.keys(shape).sort()).toEqual(["force", "repo", "slug"].sort());
    const schema = z.object(shape);
    expect(schema.parse({ repo: "r", slug: "s" })).toEqual({ repo: "r", slug: "s" });
    expect(() => schema.parse({ slug: "s" })).toThrow();
    expect(() => schema.parse({ repo: "r" })).toThrow();
  });

  it("workspace_exec: command is an enum, workspace omitted, kebab→camel", () => {
    const shape = buildToolInputSchema(EXEC_BINDING);
    expect(Object.keys(shape)).toContain("dryRun");
    expect(Object.keys(shape)).not.toContain("workspace");
    const schema = z.object(shape);
    expect(schema.parse({ command: "test" }).command).toBe("test");
    expect(() => schema.parse({ command: "bogus" })).toThrow();
    expect(() => schema.parse({})).toThrow();
  });
});
