import { describe, expect, it } from "bun:test";

import { GLOBAL_FLAGS, type HelpGroup } from "../../../../lib/help/registry";
import { render } from "../../../../lib/render";
import { stripAnsi } from "../../../../lib/render/color";
import { helpPorcelain, helpText } from "../../../../lib/render/formatters/help";

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
    // At root depth, global flags must show descriptions, not just names
    expect(out).toContain("JSON output ({ok, data} envelope)");
    // The flag and its description should be on the same line
    const lines = out.split("\n");
    const jsonLine = lines.find((l) => l.includes("--json") && l.includes("JSON output"));
    expect(jsonLine).toBeDefined();
  });

  it("group: global flags use compact comma-separated form", () => {
    const view = {
      path: ["grove", "ws"],
      node: fixture.children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpText(view, baseCtx);
    expect(out).toContain("--json, --porcelain, --text, --no-color, --ascii");
    expect(out).not.toContain("JSON output ({ok, data} envelope)");
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

describe("helpPorcelain", () => {
  it("leaf: single tab-separated row 'path<TAB>kind<TAB>summary'", () => {
    const ws = fixture.children[0] as HelpGroup;
    const view = {
      path: ["grove", "ws", "add"],
      node: ws.children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpPorcelain(view);
    expect(out).toBe("grove ws add\tleaf\tcreate a workspace");
  });

  it("group: one row per node in the subtree", () => {
    const view = {
      path: ["grove", "ws"],
      node: fixture.children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpPorcelain(view);
    const rows = out.split("\n");
    expect(rows).toContain("grove ws\tgroup\tmanage workspaces, repos, and worktrees");
    expect(rows).toContain("grove ws add\tleaf\tcreate a workspace");
  });

  it("root: enumerates entire tree", () => {
    const view = {
      path: ["grove"],
      node: fixture,
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpPorcelain(view);
    const rows = out.split("\n");
    expect(rows[0]).toBe("grove\tgroup\tmanage workspaces");
    expect(rows.length).toBe(3);
  });

  it("every row has exactly three tab-separated fields", () => {
    const view = {
      path: ["grove"],
      node: fixture,
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpPorcelain(view);
    for (const row of out.split("\n")) {
      const parts = row.split("\t");
      expect(parts.length).toBe(3);
    }
  });

  it("live REGISTRY produces clean rows: 3 fields, no embedded tabs", async () => {
    const { REGISTRY } = await import("../../../../lib/help/registry");
    const view = {
      path: ["grove"],
      node: REGISTRY,
      globalFlags: GLOBAL_FLAGS,
    };
    const out = helpPorcelain(view);
    const rows = out.split("\n");
    expect(rows.length).toBeGreaterThan(5); // sanity: registry has many nodes
    for (const row of rows) {
      const parts = row.split("\t");
      expect(parts.length, `row "${row}" must have exactly 3 fields`).toBe(3);
      // No embedded tabs in any field beyond the separators
      for (const part of parts) {
        expect(part.includes("\t"), `field "${part}" contains an embedded tab`).toBe(false);
      }
    }
  });
});

describe("render: enriched MISSING_ARG error", () => {
  it("text mode: error then help text on stderr, exit 1", () => {
    const view = {
      path: ["grove", "ws", "add"],
      node: (fixture.children[0] as HelpGroup).children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const r = render(
      { ok: false, code: "MISSING_ARG", error: "missing required argument: name", help: view },
      "help",
      {
        mode: "text",
        colorEnabled: false,
        unicodeEnabled: true,
        isTTY: false,
        isStderrTTY: false,
        warnings: [],
      },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("missing required argument: name");
    expect(r.stderr).toContain("grove ws add");
  });

  it("json mode: payload includes help field", () => {
    const view = {
      path: ["grove", "ws", "add"],
      node: (fixture.children[0] as HelpGroup).children[0],
      globalFlags: GLOBAL_FLAGS,
    };
    const r = render(
      { ok: false, code: "MISSING_ARG", error: "missing required argument: name", help: view },
      "help",
      {
        mode: "json",
        colorEnabled: false,
        unicodeEnabled: true,
        isTTY: false,
        isStderrTTY: false,
        warnings: [],
      },
    );
    const parsed = JSON.parse(r.stderr);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MISSING_ARG");
    expect(parsed.help.path).toEqual(["grove", "ws", "add"]);
  });
});
