import { describe, expect, it } from "bun:test";

import {
  GLOBAL_FLAGS,
  type HelpGroup,
  type HelpLeaf,
  type HelpNode,
  REGISTRY,
} from "../../../lib/help/registry";

function walk(
  node: HelpNode,
  visit: (n: HelpNode, path: string[]) => void,
  path: string[] = [],
): void {
  const here = [...path, node.name];
  visit(node, here);
  if (node.kind === "group") {
    for (const child of node.children) {
      walk(child, visit, here);
    }
  }
}

describe("REGISTRY invariants", () => {
  it("root is a group named 'grove'", () => {
    expect(REGISTRY.kind).toBe("group");
    expect(REGISTRY.name).toBe("grove");
  });

  it("every group has at least one child", () => {
    walk(REGISTRY, (n, path) => {
      if (n.kind === "group") {
        expect(n.children.length, `group ${path.join(" ")} must have children`).toBeGreaterThan(0);
      }
    });
  });

  it("every node has a non-empty summary", () => {
    walk(REGISTRY, (n, path) => {
      expect(n.summary.length, `node ${path.join(" ")} needs a summary`).toBeGreaterThan(0);
    });
  });

  it("no duplicate child names within a group", () => {
    walk(REGISTRY, (n, path) => {
      if (n.kind !== "group") {
        return;
      }
      const names = n.children.map((c) => c.name);
      expect(new Set(names).size, `duplicate name in group ${path.join(" ")}`).toBe(names.length);
    });
  });

  it("no alias collides with a sibling's name", () => {
    walk(REGISTRY, (n, path) => {
      if (n.kind !== "group") {
        return;
      }
      const names = new Set(n.children.map((c) => c.name));
      for (const child of n.children) {
        for (const alias of child.aliases ?? []) {
          expect(
            names.has(alias),
            `alias '${alias}' on ${path.join(" ")} ${child.name} collides with sibling`,
          ).toBe(false);
        }
      }
    });
  });

  it("every flag's valueLabel is either absent or non-empty", () => {
    walk(REGISTRY, (n) => {
      if (n.kind !== "leaf") {
        return;
      }
      for (const flag of n.flags ?? []) {
        if (flag.valueLabel !== undefined) {
          expect(
            flag.valueLabel.length,
            `flag ${flag.name} valueLabel must be non-empty`,
          ).toBeGreaterThan(0);
        }
      }
    });
  });

  it("every example command starts with 'grove '", () => {
    walk(REGISTRY, (n) => {
      if (n.kind !== "leaf") {
        return;
      }
      for (const ex of n.examples ?? []) {
        expect(
          ex.command.startsWith("grove "),
          `example must start with 'grove ': ${ex.command}`,
        ).toBe(true);
      }
    });
  });

  it("GLOBAL_FLAGS is non-empty and covers output modes", () => {
    const names = GLOBAL_FLAGS.map((f) => f.name);
    expect(names).toContain("json");
    expect(names).toContain("porcelain");
    expect(names).toContain("text");
    expect(names).toContain("no-color");
    expect(names).toContain("ascii");
  });

  it("GLOBAL_FLAGS includes --version with -V mentioned in summary", () => {
    const version = GLOBAL_FLAGS.find((f) => f.name === "version");
    expect(version).toBeDefined();
    expect(version?.summary).toContain("-V");
  });
});

const _exhaustive: HelpNode = REGISTRY satisfies HelpGroup;
void _exhaustive;
const _leaf: HelpLeaf = { kind: "leaf", name: "x", summary: "x" };
void _leaf;
