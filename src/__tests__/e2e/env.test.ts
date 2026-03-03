import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { cleanupTempRoot, createTempRoot, runCLI } from "./helpers";

describe("E2E: deprecation warnings", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });

  afterEach(() => cleanupTempRoot(root));

  it("warns with value when DOTCLAUDE_ROOT is set and GROVE_ROOT is not", async () => {
    const r = await runCLI(["ws", "list"], { env: { DOTCLAUDE_ROOT: root } });
    const quoted = JSON.stringify(root);
    expect(r.stderr).toContain(
      `DOTCLAUDE_ROOT=${quoted} is deprecated. Rename it to GROVE_ROOT=${quoted}`,
    );
  });

  it("falls back to DOTCLAUDE_ROOT when GROVE_ROOT is not set", async () => {
    // Create a workspace using root as the grove root
    await runCLI(["ws", "add", "myws"], { root });
    // Now use DOTCLAUDE_ROOT without GROVE_ROOT — should still find the workspace
    const r = await runCLI(["ws", "list"], { env: { DOTCLAUDE_ROOT: root } });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((w) => w.name)).toContain("myws");
  });

  it("does not warn when GROVE_ROOT is set (even if DOTCLAUDE_ROOT is also set)", async () => {
    const r = await runCLI(["ws", "list"], {
      root,
      env: { DOTCLAUDE_ROOT: root },
    });
    expect(r.stderr).not.toContain("DOTCLAUDE_ROOT");
  });

  it("warns with value when DOTCLAUDE_WORKSPACE is set and GROVE_WORKSPACE is not (ws exec path)", async () => {
    // ws exec fails (no repo), but the warning still fires before the error
    const r = await runCLI(["ws", "exec", "test"], {
      root,
      env: { DOTCLAUDE_WORKSPACE: "myws" },
    });
    expect(r.stderr).toContain(
      `DOTCLAUDE_WORKSPACE="myws" is deprecated. Rename it to GROVE_WORKSPACE="myws"`,
    );
  });

  it("warns with value when DOTCLAUDE_WORKSPACE is set and GROVE_WORKSPACE is not (mcp-server path)", async () => {
    // mcp-server fails fast (workspace not found), but warning fires first
    const r = await runCLI(["mcp-server"], {
      root,
      env: { DOTCLAUDE_WORKSPACE: "myws" },
    });
    expect(r.stderr).toContain(
      `DOTCLAUDE_WORKSPACE="myws" is deprecated. Rename it to GROVE_WORKSPACE="myws"`,
    );
  });

  it("does not warn when GROVE_WORKSPACE is set (ws exec path)", async () => {
    const r = await runCLI(["ws", "exec", "test"], {
      root,
      env: { GROVE_WORKSPACE: "myws" },
    });
    expect(r.stderr).not.toContain("DOTCLAUDE_WORKSPACE");
  });
});

describe("E2E: GROVE_WORKSPACE plumbed to all ws subcommands", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
    await runCLI(["ws", "add", "myws"], { root });
  });

  afterEach(() => cleanupTempRoot(root));

  // Subcommands that exit 0 when workspace exists and is empty
  const cleanCases: [string, string[]][] = [
    ["ws status", ["ws", "status"]],
    ["ws sync", ["ws", "sync"]],
    ["ws path", ["ws", "path"]],
    ["ws remove", ["ws", "remove"]],
    ["ws repo list", ["ws", "repo", "list"]],
    ["ws worktree prune", ["ws", "worktree", "prune"]],
  ];

  it.each(cleanCases)("%s exits 0 when workspace comes from GROVE_WORKSPACE", async (_, args) => {
    const r = await runCLI(args, { root, env: { GROVE_WORKSPACE: "myws" } });
    expect(r.exitCode).toBe(0);
  });

  it.each(
    cleanCases,
  )("%s exits 0 and emits deprecation warning when workspace comes from DOTCLAUDE_WORKSPACE", async (_, args) => {
    const r = await runCLI(args, {
      root,
      env: { DOTCLAUDE_WORKSPACE: "myws" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("DOTCLAUDE_WORKSPACE");
    expect(r.stderr).toContain("is deprecated");
  });

  // Subcommands that need a repo/worktree arg: workspace resolves from env,
  // failure is for a different reason (not WORKSPACE_NOT_FOUND)
  const repoArgCases: [string, string[]][] = [
    ["ws repo add", ["ws", "repo", "add", "/nonexistent"]],
    ["ws repo remove", ["ws", "repo", "remove", "gone"]],
    ["ws worktree add", ["ws", "worktree", "add", "gone", "branch", "--new"]],
    ["ws worktree list", ["ws", "worktree", "list", "gone"]],
    ["ws worktree remove", ["ws", "worktree", "remove", "gone", "slug"]],
  ];

  it.each(
    repoArgCases,
  )("%s resolves workspace from GROVE_WORKSPACE (fails for non-workspace reason)", async (_, args) => {
    const r = await runCLI(args, { root, env: { GROVE_WORKSPACE: "myws" } });
    // Some commands may exit 0 (e.g. ws worktree list with unknown repo returns empty).
    // The guard is intentional: we only assert the error code when there is a failure.
    if (r.exitCode !== 0) {
      const errJson = JSON.parse(r.stderr) as { code?: string };
      expect(errJson.code).not.toBe("WORKSPACE_NOT_FOUND");
    }
  });
});
