import { describe, expect, it } from "bun:test";

import { GLOBAL_FLAGS, type HelpGroup } from "../../../../lib/help/registry";
import { stripAnsi } from "../../../../lib/render/color";
import { helpText } from "../../../../lib/render/formatters/help";

const baseCtx = {
  colorEnabled: false,
  unicodeEnabled: true,
  isTTY: false,
  isStderrTTY: false,
};

const fixture: HelpGroup = {
  kind: "group",
  name: "grove",
  summary: "manage workspaces",
  children: [
    {
      kind: "group",
      name: "ws",
      aliases: ["workspaces"],
      summary: "manage workspaces, repos, and worktrees",
      children: [
        {
          kind: "leaf",
          name: "add",
          summary: "create a workspace",
          args: [{ name: "name", required: true, summary: "workspace name" }],
        },
      ],
    },
  ],
};

describe("helpText", () => {
  it("top-level: title, commands list, global flags, and footer", () => {
    const view = {
      path: ["grove"],
      node: fixture,
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpText(view, baseCtx);
    expect(out).toContain("grove — manage workspaces");
    expect(out).toContain("Usage:");
    expect(out).toContain("grove <command>");
    expect(out).toContain("Commands:");
    expect(out).toContain("ws");
    expect(out).toContain("(alias: workspaces)");
    expect(out).toContain("Global flags:");
    expect(out).toContain("--json");
    expect(out).toContain("Run `grove <command> --help`");
  });

  it("group: title with aliases line, subcommands list", () => {
    const view = {
      path: ["grove", "ws"],
      node: fixture.children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpText(view, baseCtx);
    expect(out).toContain("grove ws — manage workspaces");
    expect(out).toContain("aliases: workspaces");
    expect(out).toContain("Subcommands:");
    expect(out).toContain("add");
    expect(out).toContain("create a workspace");
  });

  it("leaf: usage line, arguments, no flags section if none", () => {
    const ws = fixture.children[0] as HelpGroup;
    const view = {
      path: ["grove", "ws", "add"],
      node: ws.children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpText(view, baseCtx);
    expect(out).toContain("grove ws add — create a workspace");
    expect(out).toContain("Usage:");
    expect(out).toContain("grove ws add <name>");
    expect(out).toContain("Arguments:");
    expect(out).toContain("<name>");
    expect(out).not.toContain("Flags:");
    expect(out).toContain("Global flags:");
  });

  it("note: line is rendered when present", () => {
    const view = {
      path: ["grove", "ws"],
      node: fixture.children[0],
      globalFlags: GLOBAL_FLAGS,
      note: "unknown subcommand 'fooo' — showing help for `grove ws`",
    };
    const out = helpText(view, baseCtx);
    expect(out.split("\n")[0]).toContain("note:");
    expect(out).toContain("unknown subcommand 'fooo'");
  });

  it("color stripping invariant: stripAnsi(colored) === uncolored", () => {
    const view = {
      path: ["grove"],
      node: fixture,
      globalFlags: GLOBAL_FLAGS,
    };
    const colored = helpText(view, { ...baseCtx, colorEnabled: true });
    const plain = helpText(view, { ...baseCtx, colorEnabled: false });
    expect(stripAnsi(colored)).toBe(plain);
  });

  it("ASCII fallback: em-dash becomes ' -- ' under unicodeEnabled=false", () => {
    const view = {
      path: ["grove"],
      node: fixture,
      globalFlags: GLOBAL_FLAGS,
    };
    const ascii = helpText(view, { ...baseCtx, unicodeEnabled: false });
    expect(ascii).toContain("grove -- manage workspaces");
    expect(ascii).not.toContain("—");
  });
});
