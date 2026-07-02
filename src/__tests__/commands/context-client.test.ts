import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listContextSessions, runContextTouch } from "../../commands/context-client";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { startDaemon } from "../../lib/daemon";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("runContextTouch / listContextSessions: daemon routing", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let stopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    const repoPath = await createTestGitRepo(tempDir, "api");
    await addWorkspace("ws", paths);
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("ws", "api", "feature/auth", { newBranch: true }, paths, GIT_ENV);
    const featureRoot = paths.worktreeDir("ws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# feature root\n");
  });

  afterEach(async () => {
    await stopFn?.();
    stopFn = null;
    await cleanup(tempDir);
  });

  it("falls back to stateless local touch when no daemon is discoverable", async () => {
    // No daemon has been started for this workspace, so discoverDaemon finds
    // nothing (no discovery file at paths.daemonConfig("ws")) and the call
    // must fall back to the local stateless touchContext path rather than
    // throwing or erroring.
    const result = await runContextTouch(
      "ws",
      ["trees/api/feature-auth"],
      { cwd: paths.workspace("ws") },
      paths,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entries.length).toBeGreaterThan(0);
    expect(result.value.entries.every((e) => e.status === "served")).toBe(true);
  });

  it("routes to a running daemon and reuses its session ledger across calls", async () => {
    const info = await startDaemon({ workspace: "ws", paths, gracePeriodMs: 500 });
    stopFn = info.stop;
    const cwd = paths.workspace("ws");

    const first = await runContextTouch(
      "ws",
      ["trees/api/feature-auth"],
      { cwd, session: "hook-1" },
      paths,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.entries.every((e) => e.status === "served")).toBe(true);

    const second = await runContextTouch(
      "ws",
      ["trees/api/feature-auth"],
      { cwd, session: "hook-1" },
      paths,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.entries.every((e) => e.status === "current")).toBe(true);
  });

  it("listContextSessions returns the daemon's session ledgers", async () => {
    const info = await startDaemon({ workspace: "ws", paths, gracePeriodMs: 500 });
    stopFn = info.stop;
    const cwd = paths.workspace("ws");

    await runContextTouch("ws", ["trees/api/feature-auth"], { cwd, session: "hook-1" }, paths);

    const result = await listContextSessions("ws", paths);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workspace).toBe("ws");
    const session = result.value.sessions.find((s) => s.session === "hook-1");
    expect(session).toBeDefined();
    expect(session?.scopes.length).toBeGreaterThan(0);
  });
});
