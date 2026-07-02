import { describe, expect, it } from "bun:test";

import type { GroveContext, TouchContext } from "../../../../commands/context";
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
  workspaceInstructions: {
    repo: "",
    slug: "",
    scope: "workspace",
    scopePath: ".grove",
    sourcePath: ".grove/instructions.md",
    path: ".grove/instructions.md",
    kind: "workspace",
    layer: "workspace",
    ownership: "user",
    selectionReason: "workspace instruction file",
    contentHash: "workspace-content-hash",
    contextKey: "myws/workspace",
    loadCommand: "grove ws context myws",
    hash: "workspace-content-hash",
    content: "# Workspace\n\nUse shared workspace instructions.",
  },
  index: [
    {
      repo: "api",
      slug: "feature-auth",
      scope: "api/feature-auth/packages/auth",
      scopePath: "trees/api/feature-auth/packages/auth",
      sourcePath: "trees/api/feature-auth/packages/auth/AGENTS.md",
      kind: "AGENTS.md",
      layer: "target",
      ownership: "user",
      selectionReason: "selected by worktree instruction priority",
      contentHash: "abc123",
      contextKey: "myws/api/feature-auth/packages/auth",
      loadCommand: "grove ws context myws trees/api/feature-auth/packages/auth",
      hash: "abc123",
    },
  ],
  graph: {
    root: "sha256:workspace-root",
    nodes: [],
  },
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
      repo: "",
      slug: "",
      scope: "workspace",
      scopePath: ".grove",
      sourcePath: ".grove/instructions.md",
      path: ".grove/instructions.md",
      kind: "workspace",
      layer: "workspace",
      ownership: "user",
      selectionReason: "workspace instruction file",
      contentHash: "workspace-content-hash",
      contextKey: "myws/workspace",
      loadCommand: "grove ws context myws",
      hash: "workspace-content-hash",
      content: "# Workspace\n\nUse shared workspace instructions.",
    },
    {
      repo: "api",
      slug: "feature-auth",
      scope: "api/feature-auth/packages/auth",
      scopePath: "trees/api/feature-auth/packages/auth",
      sourcePath: "trees/api/feature-auth/packages/auth/AGENTS.md",
      path: "trees/api/feature-auth/packages/auth/AGENTS.md",
      kind: "AGENTS.md",
      layer: "target",
      ownership: "user",
      selectionReason: "selected by worktree instruction priority",
      contentHash: "abc123",
      contextKey: "myws/api/feature-auth/packages/auth",
      loadCommand: "grove ws context myws trees/api/feature-auth/packages/auth",
      hash: "abc123",
      content: "# Instructions\n\nUse the auth package conventions.",
    },
  ],
  graph: {
    root: "sha256:def456",
    nodes: [],
  },
  skipped: [],
};

describe("contextText", () => {
  it("renders compact workspace protocol, worktrees, and instruction index", () => {
    const out = contextText(workspaceValue, baseCtx);

    expect(out).toContain("# Grove Context");
    expect(out).toContain("workspace myws /workspaces/myws");
    expect(out).toContain("hash workspac");
    expect(out).toContain("grove ws context <target>");
    expect(out).toContain("Workspace instruction");
    expect(out).toContain("- .grove/instructions.md h:workspac");
    expect(out).not.toContain("Provenance hash:");
    expect(out).not.toContain("Use shared workspace instructions.");
    expect(out).toContain("Worktrees (2)");
    expect(out).toContain("- api/main linked main trees/api/main");
    expect(out).toContain("- api/feature-auth worktree feature/auth trees/api/feature-auth");
    expect(out).toContain("Instructions (1 unique, 0 duplicates)");
    expect(out).toContain(
      "- api/feature-auth/packages/auth AGENTS.md h:abc123 load: trees/api/feature-auth/packages/auth",
    );
    expect(out).not.toContain("source/content hash:");
    expect(out).not.toContain("selection reason:");
    expect(out).not.toContain("context key:");
    expect(out).not.toContain("  provenance hash:");
  });

  it("renders compact workspace skipped section with path and reason", () => {
    const out = contextText(
      {
        ...workspaceValue,
        skipped: [{ path: "trees/api/feature-auth/AGENTS.md", reason: "permission denied" }],
      },
      baseCtx,
    );

    expect(out).toContain("Skipped (1)");
    expect(out).toContain("- trees/api/feature-auth/AGENTS.md - permission denied");
  });

  it("groups duplicate instruction hashes in compact workspace text", () => {
    const out = contextText(
      {
        ...workspaceValue,
        index: [
          workspaceValue.index[0],
          {
            ...workspaceValue.index[0],
            repo: "api",
            slug: "other",
            scope: "api/other/packages/auth",
            scopePath: "trees/api/other/packages/auth",
            sourcePath: "trees/api/other/packages/auth/AGENTS.md",
            contextKey: "myws/api/other/packages/auth",
            loadCommand: "grove ws context myws trees/api/other/packages/auth",
          },
        ],
      },
      baseCtx,
    );

    expect(out).toContain("Instructions (1 unique, 1 duplicate)");
    expect(out.match(/h:abc123/g)).toHaveLength(1);
    expect(out).toContain("  same: trees/api/other/packages/auth");
    expect(out).not.toContain("  same: api/other/packages/auth");
    expect(out).not.toContain("trees/api/other/packages/auth/AGENTS.md");
    expect(out).not.toContain("grove ws context myws trees/api/other/packages/auth");
  });

  it("renders target resolved worktree, context hash, source heading, source hash, and content", () => {
    const out = contextText(targetValue, baseCtx);

    expect(out).toContain("Resolved worktree: api/feature-auth");
    expect(out).toContain("Loaded scope: trees/api/feature-auth/packages/auth");
    expect(out).toContain("Context hash: sha256:def456");
    expect(out).toContain("### .grove/instructions.md");
    expect(out).toContain("Kind: workspace");
    expect(out).toContain("### trees/api/feature-auth/packages/auth/AGENTS.md");
    expect(out).toContain("Kind: AGENTS.md");
    expect(out).toContain("Layer: target");
    expect(out).toContain("Ownership: user");
    expect(out).toContain("Selection reason: selected by worktree instruction priority");
    expect(out).toContain("Source/content hash: abc123");
    expect(out).not.toContain("Provenance hash:");
    expect(out).toContain("# Instructions\n\nUse the auth package conventions.");
  });

  it("renders target reload command with the stable loaded scope", () => {
    const out = contextText({ ...targetValue, target: "." }, baseCtx);

    expect(out).toContain(
      "Reload with `grove ws context myws trees/api/feature-auth/packages/auth`",
    );
    expect(out).not.toContain("Reload with `grove ws context .`");
  });

  it("renders target no-instructions message when sources is empty", () => {
    const out = contextText({ ...targetValue, sources: [] }, baseCtx);

    expect(out).toContain("No instruction files found for this target.");
  });

  it("renders target skipped section with the markdown heading", () => {
    const out = contextText(
      {
        ...targetValue,
        skipped: [{ path: "trees/api/feature-auth/AGENTS.md", reason: "permission denied" }],
      },
      baseCtx,
    );

    expect(out).toContain("## Skipped");
    expect(out).not.toContain("Skipped (1)");
    expect(out).toContain("- trees/api/feature-auth/AGENTS.md - permission denied");
  });
});

describe("contextPorcelain", () => {
  it("renders workspace rows exactly matching the schema", () => {
    expect(contextPorcelain(workspaceValue)).toBe(
      [
        [
          "source",
          "myws",
          "",
          "",
          "workspace",
          ".grove/instructions.md",
          "workspace",
          "workspace-content-hash",
          "myws/workspace",
          "workspace",
          "user",
          "workspace instruction file",
          "workspace-content-hash",
        ].join("\t"),
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
          "target",
          "user",
          "selected by worktree instruction priority",
          "abc123",
        ].join("\t"),
      ].join("\n"),
    );
  });

  it("keeps duplicate workspace instruction rows exhaustive in porcelain", () => {
    const duplicate = {
      ...workspaceValue.index[0],
      repo: "api",
      slug: "other",
      scope: "api/other/packages/auth",
      scopePath: "trees/api/other/packages/auth",
      sourcePath: "trees/api/other/packages/auth/AGENTS.md",
      contextKey: "myws/api/other/packages/auth",
      loadCommand: "grove ws context myws trees/api/other/packages/auth",
    };

    const rows = contextPorcelain({
      ...workspaceValue,
      index: [workspaceValue.index[0], duplicate],
    }).split("\n");

    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("trees/api/feature-auth/packages/auth/AGENTS.md");
    expect(rows[2]).toContain("trees/api/other/packages/auth/AGENTS.md");
  });

  it("renders target metadata row with the same scope format as source rows", () => {
    const out = contextPorcelain(targetValue);
    const rows = out.split("\n");

    expect(rows[0]).toBe(
      [
        "target",
        "myws",
        "api",
        "feature-auth",
        "api/feature-auth/packages/auth",
        "trees/api/feature-auth",
        "myws/api/feature-auth/packages/auth",
        "sha256:def456",
      ].join("\t"),
    );
    expect(rows).toContain(
      [
        "source",
        "myws",
        "",
        "",
        "workspace",
        ".grove/instructions.md",
        "workspace",
        "workspace-content-hash",
        "myws/workspace",
        "workspace",
        "user",
        "workspace instruction file",
        "workspace-content-hash",
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
        "target",
        "user",
        "selected by worktree instruction priority",
        "abc123",
      ].join("\t"),
    );
  });

  it("returns empty string for workspace mode with no index entries", () => {
    expect(
      contextPorcelain({
        ...workspaceValue,
        workspaceInstructions: undefined,
        index: [],
      }),
    ).toBe("");
  });

  it("renders target metadata row when there are no loaded sources", () => {
    expect(contextPorcelain({ ...targetValue, sources: [] })).toBe(
      [
        "target",
        "myws",
        "api",
        "feature-auth",
        "api/feature-auth/packages/auth",
        "trees/api/feature-auth",
        "myws/api/feature-auth/packages/auth",
        "sha256:def456",
      ].join("\t"),
    );
  });
});

const touchValue: TouchContext = {
  mode: "touch",
  workspace: { name: "ai", path: "/w/ai" },
  session: "s1",
  entries: [
    {
      contextKey: "ai/grove/main",
      scopePath: "trees/grove/main",
      sourcePath: "trees/grove/main/AGENTS.md",
      contentHash: "aaaa1111aaaa",
      status: "current",
    },
    {
      contextKey: "ai/grove/main/src",
      scopePath: "trees/grove/main/src",
      sourcePath: "trees/grove/main/src/AGENTS.md",
      contentHash: "bbbb2222bbbb",
      status: "served",
      content: "body",
    },
    {
      contextKey: "ai/grove/main/src/lib",
      scopePath: "trees/grove/main/src/lib",
      sourcePath: "trees/grove/main/src/lib/AGENTS.md",
      contentHash: "cccc3333cccc",
      status: "updated",
      content: "updated body",
    },
  ],
  skipped: [],
};

describe("contextText: touch mode", () => {
  it("renders content-first with marker lines for current/updated entries", () => {
    const text = contextText(touchValue, baseCtx);

    expect(text).toContain("# Grove Context Touch");
    expect(text).toContain("- current ai/grove/main@aaaa1111");
    expect(text).toContain("- updated ai/grove/main/src/lib@cccc3333");
    expect(text).toContain("## trees/grove/main/src/AGENTS.md @bbbb2222");
    expect(text).toContain("body");
    expect(text).toContain("## trees/grove/main/src/lib/AGENTS.md @cccc3333");
    expect(text).toContain("updated body");
  });

  it("does not emit a marker line for served entries", () => {
    const text = contextText(touchValue, baseCtx);
    expect(text).not.toContain("- served");
  });

  it("omits Kind/Layer/Ownership/Selection-reason framing", () => {
    const text = contextText(touchValue, baseCtx);
    expect(text).not.toContain("Ownership");
    expect(text).not.toContain("Kind:");
    expect(text).not.toContain("Layer:");
    expect(text).not.toContain("Selection reason:");
  });

  it("renders a 'no scopes' message when entries is empty", () => {
    const text = contextText({ ...touchValue, entries: [] }, baseCtx);
    expect(text).toContain("No instruction scopes for the given paths.");
  });

  it("renders the skipped section with the markdown heading", () => {
    const text = contextText(
      { ...touchValue, skipped: [{ path: "trees/x/AGENTS.md", reason: "permission denied" }] },
      baseCtx,
    );
    expect(text).toContain("## Skipped");
    expect(text).toContain("- trees/x/AGENTS.md - permission denied");
  });
});

describe("contextPorcelain: touch mode", () => {
  it("renders one touch row per entry", () => {
    const out = contextPorcelain(touchValue);
    const rows = out.split("\n");

    expect(rows).toEqual([
      [
        "touch",
        "ai",
        "ai/grove/main",
        "current",
        "aaaa1111aaaa",
        "trees/grove/main/AGENTS.md",
      ].join("\t"),
      [
        "touch",
        "ai",
        "ai/grove/main/src",
        "served",
        "bbbb2222bbbb",
        "trees/grove/main/src/AGENTS.md",
      ].join("\t"),
      [
        "touch",
        "ai",
        "ai/grove/main/src/lib",
        "updated",
        "cccc3333cccc",
        "trees/grove/main/src/lib/AGENTS.md",
      ].join("\t"),
    ]);
  });
});
