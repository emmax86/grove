import { describe, expect, it } from "bun:test";

import { renderTree } from "../../../lib/render/tree";

interface Node {
  name: string;
  children?: Node[];
}

describe("renderTree", () => {
  const getChildren = (n: Node) => n.children ?? [];
  const label = (n: Node) => n.name;

  it("renders a leaf-only root with unicode chars", () => {
    const root: Node = { name: "root" };
    expect(renderTree(root, getChildren, label, { unicode: true })).toBe("root");
  });

  it("renders root with two children using unicode", () => {
    const root: Node = {
      name: "root",
      children: [{ name: "a" }, { name: "b" }],
    };
    expect(renderTree(root, getChildren, label, { unicode: true })).toBe("root\n├── a\n└── b");
  });

  it("renders nested children using unicode", () => {
    const root: Node = {
      name: "r",
      children: [{ name: "a", children: [{ name: "a1" }, { name: "a2" }] }, { name: "b" }],
    };
    expect(renderTree(root, getChildren, label, { unicode: true })).toBe(
      "r\n├── a\n│   ├── a1\n│   └── a2\n└── b",
    );
  });

  it("renders ASCII fallback when unicode=false", () => {
    const root: Node = {
      name: "r",
      children: [{ name: "a", children: [{ name: "a1" }] }, { name: "b" }],
    };
    expect(renderTree(root, getChildren, label, { unicode: false })).toBe(
      "r\n+-- a\n|   `-- a1\n`-- b",
    );
  });
});
