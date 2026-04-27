import { describe, expect, it } from "bun:test";

import { isHelpRequested, resolveCommandPath } from "../../../lib/help/dispatch";
import type { HelpGroup } from "../../../lib/help/registry";

const fixture: HelpGroup = {
  kind: "group",
  name: "root",
  summary: "root",
  children: [
    {
      kind: "group",
      name: "ws",
      aliases: ["workspaces"],
      summary: "ws",
      children: [
        { kind: "leaf", name: "add", summary: "add workspace" },
        {
          kind: "group",
          name: "repo",
          summary: "repo",
          children: [{ kind: "leaf", name: "add", summary: "add repo" }],
        },
      ],
    },
    { kind: "leaf", name: "mcp-server", summary: "mcp" },
  ],
};

describe("isHelpRequested", () => {
  it("true for --help anywhere", () => {
    expect(isHelpRequested(["--help"], fixture)).toBe(true);
    expect(isHelpRequested(["ws", "--help"], fixture)).toBe(true);
    expect(isHelpRequested(["--help", "ws"], fixture)).toBe(true);
    expect(isHelpRequested(["ws", "repo", "add", "--help"], fixture)).toBe(true);
  });

  it("true for -h", () => {
    expect(isHelpRequested(["-h"], fixture)).toBe(true);
    expect(isHelpRequested(["ws", "-h", "repo"], fixture)).toBe(true);
  });

  it("true for positional 'help' at a command-slot (group) position", () => {
    expect(isHelpRequested(["help"], fixture)).toBe(true);
    expect(isHelpRequested(["help", "ws", "repo"], fixture)).toBe(true);
    expect(isHelpRequested(["ws", "help"], fixture)).toBe(true);
    expect(isHelpRequested(["ws", "help", "repo"], fixture)).toBe(true);
  });

  it("false otherwise", () => {
    expect(isHelpRequested([], fixture)).toBe(false);
    expect(isHelpRequested(["ws", "add", "myws"], fixture)).toBe(false);
    expect(isHelpRequested(["--workspace", "foo"], fixture)).toBe(false);
    // flag value happening to equal "help" must not trip help mode
    expect(isHelpRequested(["ws", "add", "--workspace", "help"], fixture)).toBe(false);
    expect(isHelpRequested(["--workspace", "help"], fixture)).toBe(false);
    // positional "help" after a leaf or unmatched token is a data arg, not help trigger
    expect(isHelpRequested(["ws", "add", "help"], fixture)).toBe(false);
    expect(isHelpRequested(["mcp-server", "help"], fixture)).toBe(false);
    expect(isHelpRequested(["ws", "fooo", "help"], fixture)).toBe(false);
  });
});

describe("resolveCommandPath", () => {
  it("empty argv -> root", () => {
    const r = resolveCommandPath([], fixture);
    expect(r.path).toEqual(["root"]);
    expect(r.node.kind).toBe("group");
    expect(r.unmatched).toEqual([]);
  });

  it("['ws'] -> ws group", () => {
    const r = resolveCommandPath(["ws"], fixture);
    expect(r.path).toEqual(["root", "ws"]);
    expect(r.node.name).toBe("ws");
    expect(r.unmatched).toEqual([]);
  });

  it("['ws', 'add'] -> ws/add leaf", () => {
    const r = resolveCommandPath(["ws", "add"], fixture);
    expect(r.path).toEqual(["root", "ws", "add"]);
    expect(r.node.kind).toBe("leaf");
    expect(r.node.name).toBe("add");
  });

  it("['ws', 'repo', 'add'] -> nested leaf", () => {
    const r = resolveCommandPath(["ws", "repo", "add"], fixture);
    expect(r.path).toEqual(["root", "ws", "repo", "add"]);
    expect(r.node.name).toBe("add");
  });

  it("alias 'workspaces' resolves to 'ws'", () => {
    const r = resolveCommandPath(["workspaces"], fixture);
    expect(r.node.name).toBe("ws");
  });

  it("unmatched trailing token -> deepest match plus unmatched", () => {
    const r = resolveCommandPath(["ws", "fooo"], fixture);
    expect(r.path).toEqual(["root", "ws"]);
    expect(r.node.name).toBe("ws");
    expect(r.unmatched).toEqual(["fooo"]);
  });

  it("--help anywhere doesn't affect resolution", () => {
    const a = resolveCommandPath(["--help", "ws", "repo", "add"], fixture);
    const b = resolveCommandPath(["ws", "--help", "repo", "add"], fixture);
    const c = resolveCommandPath(["ws", "repo", "add", "--help"], fixture);
    expect(a.path).toEqual(b.path);
    expect(b.path).toEqual(c.path);
    expect(a.node.name).toBe("add");
  });

  it("positional 'help' is stripped from path walk", () => {
    const a = resolveCommandPath(["help", "ws", "repo"], fixture);
    const b = resolveCommandPath(["ws", "help", "repo"], fixture);
    const c = resolveCommandPath(["ws", "repo", "--help"], fixture);
    expect(a.node.name).toBe("repo");
    expect(b.node.name).toBe("repo");
    expect(c.node.name).toBe("repo");
  });

  it("flags with values do not pollute the path", () => {
    const r = resolveCommandPath(["--workspace", "myws", "ws", "add", "--help"], fixture);
    expect(r.path).toEqual(["root", "ws", "add"]);
    expect(r.unmatched).toEqual([]);
  });

  it("an unmatched token before --help -> deepest match plus unmatched", () => {
    const r = resolveCommandPath(["ws", "fooo", "--help"], fixture);
    expect(r.path).toEqual(["root", "ws"]);
    expect(r.unmatched).toEqual(["fooo"]);
  });
});
