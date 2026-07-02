import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cleanupTempRoot, createGitRepo, createTempRoot, runCLI } from "./helpers";

describe("E2E: context inference via cwd", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    [repoPath] = await Promise.all([
      createGitRepo(root, "myrepo"),
      runCLI(["ws", "add", "myws"], { root }),
    ]);
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/ctx", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
  });

  afterEach(() => cleanupTempRoot(root));

  it("workspace inferred from cwd at workspace root", async () => {
    const r = await runCLI(["ws", "repo", "list", "--json"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).toContain("myrepo");
  });

  it("workspace and repo inferred from cwd inside repo dir", async () => {
    const r = await runCLI(["ws", "worktree", "list", "--json"], {
      root,
      cwd: join(root, "myws", "trees", "myrepo"),
    });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ slug: string }>;
    expect(data.map((w) => w.slug)).toContain("feature-ctx");
  });

  it("workspace inferred from cwd inside pool worktree (via symlink)", async () => {
    // The symlink at {ws}/trees/{repo}/{slug} points into the pool.
    // Logical cwd traversal should find workspace.json in myws.
    const wtLink = join(root, "myws", "trees", "myrepo", "feature-ctx");
    const r = await runCLI(["ws", "repo", "list", "--json"], { root, cwd: wtLink });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).toContain("myrepo");
  });

  it("ws status inferred from cwd", async () => {
    const r = await runCLI(["ws", "status", "--json"], { root, cwd: join(root, "myws") });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, unknown>;
    expect(data.name).toBe("myws");
  });

  it("explicit arg overrides cwd context", async () => {
    await runCLI(["ws", "add", "otherws"], { root });
    // cwd is myws but we explicitly pass otherws
    const r = await runCLI(["ws", "repo", "list", "otherws", "--json"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    // otherws has no repos
    const data = r.json?.data as Array<unknown>;
    expect(data).toHaveLength(0);
  });
});

describe("E2E: ws context touch/sessions/show dispatch", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    repoPath = await createGitRepo(root, "api");
    await runCLI(["ws", "add", "myws"], { root });
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    await writeFile(join(root, "myws", "trees", "api", "main", "AGENTS.md"), "# api root\n");
  });

  afterEach(() => cleanupTempRoot(root));

  it("ws context touch <path> serves instruction scopes for the path", async () => {
    const r = await runCLI(["ws", "context", "touch", "trees/api/main"], {
      root,
      cwd: join(root, "myws"),
    });

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Grove Context Touch");
  });

  it("ws context touch with no paths -> MISSING_ARG names paths", async () => {
    const r = await runCLI(["ws", "context", "touch", "--json"], {
      root,
      cwd: join(root, "myws"),
    });

    expect(r.exitCode).toBe(1);
    const json = JSON.parse(r.stderr);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("MISSING_ARG");
  });

  it("ws context sessions reports no daemon running", async () => {
    const r = await runCLI(["ws", "context", "sessions", "--json"], {
      root,
      cwd: join(root, "myws"),
    });

    expect(r.exitCode).toBe(1);
    const json = JSON.parse(r.stderr);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("DAEMON_NOT_RUNNING");
  });

  it("ws context show <ws> <target> strips the explicit 'show' token and loads the target", async () => {
    const r = await runCLI(["ws", "context", "show", "myws", "trees/api/main", "--json"], { root });

    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    const data = r.json?.data as { mode: string };
    expect(data.mode).toBe("target");
  });

  it("ws context <ws> <target> (no subcommand) still works — backward compatibility", async () => {
    const r = await runCLI(["ws", "context", "myws", "trees/api/main", "--json"], { root });

    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    const data = r.json?.data as { mode: string; repo: string; slug: string };
    expect(data.mode).toBe("target");
    expect(data.repo).toBe("api");
    expect(data.slug).toBe("main");
  });
});
