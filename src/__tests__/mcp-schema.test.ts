import { describe, expect, it } from "bun:test";

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
