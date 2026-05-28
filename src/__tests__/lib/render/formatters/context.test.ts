import { describe, expect, it } from "bun:test";

import type { GroveContext } from "../../../../commands/context";
import { contextPorcelain, contextText } from "../../../../lib/render/formatters/context";

const baseCtx = { colorEnabled: false, unicodeEnabled: true, isTTY: false, isStderrTTY: false };

const workspaceValue: GroveContext = {
  mode: "workspace",
  workspace: { name: "myws", path: "/workspaces/myws" },
  worktrees: [
    { repo: "api", slug: "main", branch: "main", type: "linked", path: "trees/api/main" },
    {
      repo: "api",
      slug: "feature-auth",
      branch: "feature/auth",
      type: "worktree",
      path: "trees/api/feature-auth",
    },
  ],
  index: [
    {
      repo: "api",
      slug: "feature-auth",
      scope: "api/feature-auth/packages/auth",
      scopePath: "trees/api/feature-auth/packages/auth",
      sourcePath: "trees/api/feature-auth/packages/auth/AGENTS.md",
      kind: "AGENTS.md",
      contextKey: "myws/api/feature-auth/packages/auth",
      loadCommand: "grove ws context trees/api/feature-auth/packages/auth",
      hash: "abc123",
    },
  ],
  skipped: [],
};

const targetValue: GroveContext = {
  mode: "target",
  workspace: { name: "myws", path: "/workspaces/myws" },
  target: "trees/api/feature-auth/packages/auth",
  repo: "api",
  slug: "feature-auth",
  worktreePath: "trees/api/feature-auth",
  loadedScope: "trees/api/feature-auth/packages/auth",
  contextKey: "myws/api/feature-auth/packages/auth",
  contextHash: "sha256:def456",
  sources: [
    {
      repo: "api",
      slug: "feature-auth",
      scope: "api/feature-auth/packages/auth",
      scopePath: "trees/api/feature-auth/packages/auth",
      sourcePath: "trees/api/feature-auth/packages/auth/AGENTS.md",
      path: "trees/api/feature-auth/packages/auth/AGENTS.md",
      kind: "AGENTS.md",
      contextKey: "myws/api/feature-auth/packages/auth",
      loadCommand: "grove ws context trees/api/feature-auth/packages/auth",
      hash: "abc123",
      content: "# Instructions\n\nUse the auth package conventions.",
    },
  ],
  skipped: [],
};

describe("contextText", () => {
  it("renders workspace protocol, worktrees, instruction index, source path, and context key", () => {
    const out = contextText(workspaceValue, baseCtx);

    expect(out).toContain("# Grove Context");
    expect(out).toContain("Workspace: myws");
    expect(out).toContain("Path: /workspaces/myws");
    expect(out).toContain("## Agent Protocol");
    expect(out).toContain("grove ws context <target>");
    expect(out).toContain("## Worktrees");
    expect(out).toContain("- api/main (linked, branch: main) - trees/api/main");
    expect(out).toContain(
      "- api/feature-auth (worktree, branch: feature/auth) - trees/api/feature-auth",
    );
    expect(out).toContain("## Instruction Index");
    expect(out).toContain("trees/api/feature-auth/packages/auth/AGENTS.md");
    expect(out).toContain("myws/api/feature-auth/packages/auth");
    expect(out).toContain("grove ws context trees/api/feature-auth/packages/auth");
  });

  it("renders workspace skipped section with path and reason", () => {
    const out = contextText(
      {
        ...workspaceValue,
        skipped: [{ path: "trees/api/feature-auth/AGENTS.md", reason: "permission denied" }],
      },
      baseCtx,
    );

    expect(out).toContain("## Skipped");
    expect(out).toContain("- trees/api/feature-auth/AGENTS.md - permission denied");
  });

  it("renders target resolved worktree, context hash, source heading, source hash, and content", () => {
    const out = contextText(targetValue, baseCtx);

    expect(out).toContain("Resolved worktree: api/feature-auth");
    expect(out).toContain("Loaded scope: trees/api/feature-auth/packages/auth");
    expect(out).toContain("Context hash: sha256:def456");
    expect(out).toContain("### trees/api/feature-auth/packages/auth/AGENTS.md");
    expect(out).toContain("Source hash: abc123");
    expect(out).toContain("# Instructions\n\nUse the auth package conventions.");
  });

  it("renders target reload command with the stable loaded scope", () => {
    const out = contextText({ ...targetValue, target: "." }, baseCtx);

    expect(out).toContain("Reload with `grove ws context trees/api/feature-auth/packages/auth`");
    expect(out).not.toContain("Reload with `grove ws context .`");
  });

  it("renders target no-instructions message when sources is empty", () => {
    const out = contextText({ ...targetValue, sources: [] }, baseCtx);

    expect(out).toContain("No instruction files found for this target.");
  });
});

describe("contextPorcelain", () => {
  it("renders workspace row exactly matching the schema", () => {
    expect(contextPorcelain(workspaceValue)).toBe(
      [
        "index",
        "myws",
        "api",
        "feature-auth",
        "api/feature-auth/packages/auth",
        "trees/api/feature-auth/packages/auth/AGENTS.md",
        "AGENTS.md",
        "abc123",
        "myws/api/feature-auth/packages/auth",
      ].join("\t"),
    );
  });

  it("renders target metadata row followed by source rows", () => {
    const out = contextPorcelain(targetValue);
    const rows = out.split("\n");

    expect(rows[0]).toBe(
      [
        "target",
        "myws",
        "api",
        "feature-auth",
        "trees/api/feature-auth/packages/auth",
        "trees/api/feature-auth",
        "myws/api/feature-auth/packages/auth",
        "sha256:def456",
      ].join("\t"),
    );
    expect(rows).toContain(
      [
        "source",
        "myws",
        "api",
        "feature-auth",
        "api/feature-auth/packages/auth",
        "trees/api/feature-auth/packages/auth/AGENTS.md",
        "AGENTS.md",
        "abc123",
        "myws/api/feature-auth/packages/auth",
      ].join("\t"),
    );
  });

  it("returns empty string for workspace mode with no index entries", () => {
    expect(contextPorcelain({ ...workspaceValue, index: [] })).toBe("");
  });

  it("renders target metadata row when there are no loaded sources", () => {
    expect(contextPorcelain({ ...targetValue, sources: [] })).toBe(
      [
        "target",
        "myws",
        "api",
        "feature-auth",
        "trees/api/feature-auth/packages/auth",
        "trees/api/feature-auth",
        "myws/api/feature-auth/packages/auth",
        "sha256:def456",
      ].join("\t"),
    );
  });
});
