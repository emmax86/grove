import { describe, expect, it } from "bun:test";

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { StandardCommand } from "../commands/exec";
import {
  buildToolInputSchema,
  EXEC_BINDING,
  findLeaf,
  MCP_TOOL_BINDINGS,
  WORKTREE_ADD_BINDING,
  WORKTREE_REMOVE_BINDING,
} from "../lib/help/mcp-schema";
import type { HelpArg } from "../lib/help/registry";

type ToolArgs<Shape extends z.ZodRawShape> = Parameters<ToolCallback<Shape>>[0];
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const workspaceAddInputSchema = buildToolInputSchema(WORKTREE_ADD_BINDING);
type WorkspaceAddArgs = ToolArgs<typeof workspaceAddInputSchema>;
type _WorkspaceAddRepoIsString = Assert<IsEqual<WorkspaceAddArgs["repo"], string>>;
type _WorkspaceAddNewBranchIsOptionalBoolean = Assert<
  IsEqual<WorkspaceAddArgs["newBranch"], boolean | undefined>
>;
type _WorkspaceAddDoesNotExposeStaleField = Assert<
  IsEqual<"repoName" extends keyof WorkspaceAddArgs ? true : false, false>
>;

const execInputSchema = buildToolInputSchema(EXEC_BINDING);
type ExecArgs = ToolArgs<typeof execInputSchema>;
type _ExecCommandIsStandardCommand = Assert<IsEqual<ExecArgs["command"], StandardCommand>>;
type _ExecDryRunIsOptionalBoolean = Assert<IsEqual<ExecArgs["dryRun"], boolean | undefined>>;

// Registry names a binding passes through verbatim (no override, not omitted),
// before MCP camelCase conversion (e.g. "dry-run" becomes "dryRun").
// Updating a binding's surface? Update this set in the same change — that is the
// conscious decision the guard is forcing.
const KNOWN_PASSTHROUGH: Record<string, Set<string>> = {
  workspace_add_worktree: new Set(["branch", "from", "no-setup"]),
  workspace_remove_worktree: new Set(["slug", "force"]),
  workspace_exec: new Set(["command", "file", "match", "repo", "dry-run"]),
};

describe("registry enum/summary data for MCP", () => {
  it("ws exec command arg carries structured enum values", () => {
    const command = findLeaf(["ws", "exec"]).args?.find((a) => a.name === "command");
    expect(command?.values).toEqual([
      "setup",
      "format",
      "test",
      "test:file",
      "test:match",
      "check",
    ]);
  });

  it("worktree add/remove repo args have a summary (for the MCP field description)", () => {
    const add = findLeaf(["ws", "worktree", "add"]).args?.find((a) => a.name === "repo");
    const remove = findLeaf(["ws", "worktree", "remove"]).args?.find((a) => a.name === "repo");
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
      // A name is covered only if the binding omits it, overrides it, or records
      // a conscious pass-through decision in KNOWN_PASSTHROUGH.
      // This guards schema shape only; handler destructuring correctness relies
      // on buildToolInputSchema's typed return in mcp-server.ts.
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

describe("findLeaf", () => {
  it("throws for an empty path", () => {
    expect(() => findLeaf([])).toThrow("registry path must not be empty");
  });

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

  it("falls back to string for an empty enum values array", () => {
    const command = findLeaf(["ws", "exec"]).args?.find((a) => a.name === "command");
    expect(command).toBeDefined();
    const mutableCommand = command as HelpArg;
    const originalValues = mutableCommand.values;
    try {
      mutableCommand.values = [];
      const shape = buildToolInputSchema(EXEC_BINDING);
      const schema = z.object(shape);
      const parsed = schema.parse({ command: "custom" }) as { command: string };
      expect(parsed.command).toBe("custom");
    } finally {
      mutableCommand.values = originalValues;
    }
  });
});
