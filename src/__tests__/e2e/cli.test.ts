import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempRoot, createGitRepo, createTempRoot, runCLI } from "./helpers";

describe("E2E: CLI output shape", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });
  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("success writes JSON to stdout only, stderr is empty", async () => {
    const r = await runCLI(["ws", "add", "myws"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    expect(r.stderr).toBe("");
  });

  it("error writes JSON to stderr only, stdout is empty, exits 1", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "add", "myws"], { root }); // duplicate
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    const err = JSON.parse(r.stderr);
    expect(err.ok).toBe(false);
    expect(typeof err.error).toBe("string");
    expect(typeof err.code).toBe("string");
  });

  it("unknown top-level command exits 1", async () => {
    const r = await runCLI(["notacommand"], { root });
    expect(r.exitCode).toBe(1);
  });

  it("unknown subcommand exits 1", async () => {
    const r = await runCLI(["ws", "notasubcmd"], { root });
    expect(r.exitCode).toBe(1);
  });
});

describe("E2E: workspace commands", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });
  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("ws add returns name and path, creates directory", async () => {
    const r = await runCLI(["ws", "add", "myws"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    const data = r.json?.data as Record<string, string>;
    expect(data.name).toBe("myws");
    expect(data.path).toBe(join(root, "myws"));
    expect(existsSync(join(root, "myws"))).toBe(true);
  });

  it("ws add rejects reserved name 'repos'", async () => {
    const r = await runCLI(["ws", "add", "repos"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("RESERVED_NAME");
  });

  it("ws add rejects reserved name 'worktrees'", async () => {
    const r = await runCLI(["ws", "add", "worktrees"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("RESERVED_NAME");
  });

  it("ws add rejects duplicate workspace", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "add", "myws"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("WORKSPACE_EXISTS");
  });

  it("ws list returns array of workspaces", async () => {
    await runCLI(["ws", "add", "ws1"], { root });
    await runCLI(["ws", "add", "ws2"], { root });
    const r = await runCLI(["ws", "list"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((w) => w.name)).toContain("ws1");
    expect(data.map((w) => w.name)).toContain("ws2");
    expect(data.map((w) => w.name)).not.toContain("repos");
    expect(data.map((w) => w.name)).not.toContain("worktrees");
  });

  it("ws list --porcelain: one name per line, no JSON", async () => {
    await runCLI(["ws", "add", "ws1"], { root });
    await runCLI(["ws", "add", "ws2"], { root });
    const r = await runCLI(["ws", "list", "--porcelain"], { root });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(lines).toContain("ws1");
    expect(lines).toContain("ws2");
    // Not JSON
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  it("ws list --porcelain empty root: empty stdout", async () => {
    const r = await runCLI(["ws", "list", "--porcelain"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("ws remove deletes workspace", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "remove", "myws"], { root });
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(root, "myws"))).toBe(false);
  });

  it("ws remove non-existent workspace exits 1", async () => {
    const r = await runCLI(["ws", "remove", "ghost"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("ws path returns workspace directory path", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "path", "myws"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, string>;
    expect(data.path).toBe(join(root, "myws"));
  });

  it("ws path --porcelain: bare path, no JSON", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "path", "myws", "--porcelain"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(join(root, "myws"));
    expect(() => JSON.parse(r.stdout)).toThrow();
  });
});

describe("E2E: repo commands", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    repoPath = await createGitRepo(root, "myrepo");
    await runCLI(["ws", "add", "myws"], { root });
  });

  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("ws repo add registers repo and returns JSON", async () => {
    const r = await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, string>;
    expect(data.name).toBe("myrepo");
    expect(data.status).toBe("ok");
  });

  it("ws repo add creates global repos/ symlink and default branch symlink", async () => {
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    expect(lstatSync(join(root, "repos", "myrepo")).isSymbolicLink()).toBe(true);
    const defaultLink = join(root, "myws", "trees", "myrepo", "main");
    expect(lstatSync(defaultLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(defaultLink)).toBe("../../../repos/myrepo");
  });

  it("ws repo add --name overrides derived name", async () => {
    const r = await runCLI(["ws", "repo", "add", "myws", repoPath, "--name", "custom"], { root });
    expect(r.exitCode).toBe(0);
    expect((r.json?.data as Record<string, string>).name).toBe("custom");
    expect(existsSync(join(root, "repos", "custom"))).toBe(true);
  });

  it("ws repo add rejects reserved name 'trees'", async () => {
    const r = await runCLI(["ws", "repo", "add", "myws", repoPath, "--name", "trees"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("RESERVED_NAME");
  });

  it("ws repo add rejects non-git directory", async () => {
    const r = await runCLI(["ws", "repo", "add", "myws", root], { root }); // root is not a git repo
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("NOT_A_GIT_REPO");
  });

  it("ws repo list returns repos", async () => {
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    const r = await runCLI(["ws", "repo", "list", "myws"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).toContain("myrepo");
  });

  it("ws repo list --porcelain: name\\tpath\\tstatus per line", async () => {
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    const r = await runCLI(["ws", "repo", "list", "myws", "--porcelain"], {
      root,
    });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const [name, path, status] = lines[0].split("\t");
    expect(name).toBe("myrepo");
    expect(path).toBe(repoPath);
    expect(status).toBe("ok");
  });

  it("ws repo remove unregisters repo", async () => {
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    const r = await runCLI(["ws", "repo", "remove", "myws", "myrepo"], {
      root,
    });
    expect(r.exitCode).toBe(0);
    // Global symlink stays
    expect(existsSync(join(root, "repos", "myrepo"))).toBe(true);
    // Not in list anymore
    const list = await runCLI(["ws", "repo", "list", "myws"], { root });
    const data = list.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).not.toContain("myrepo");
  });
});

describe("E2E: worktree commands", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    repoPath = await createGitRepo(root, "myrepo");
    await runCLI(["ws", "add", "myws"], { root });
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
  });

  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("ws worktree add --new creates pool entry and workspace symlink", async () => {
    const r = await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, string>;
    expect(data.slug).toBe("feature-x");
    expect(data.type).toBe("worktree");

    // Workspace entry is a symlink
    const wsLink = join(root, "myws", "trees", "myrepo", "feature-x");
    expect(lstatSync(wsLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(wsLink)).toBe("../../../worktrees/myrepo/feature-x");

    // Pool entry is a real directory
    const poolEntry = join(root, "worktrees", "myrepo", "feature-x");
    expect(existsSync(poolEntry)).toBe(true);
    expect(lstatSync(poolEntry).isDirectory()).toBe(true);
    expect(lstatSync(poolEntry).isSymbolicLink()).toBe(false);

    // worktrees.json records the reference
    const pool = JSON.parse(readFileSync(join(root, "worktrees.json"), "utf-8"));
    expect(pool.myrepo["feature-x"]).toContain("myws");
  });

  it("ws worktree add --from creates branch from base", async () => {
    const r = await runCLI(
      ["ws", "worktree", "add", "myrepo", "feature/from-main", "--new", "--from", "main"],
      {
        root,
        cwd: join(root, "myws"),
      },
    );
    expect(r.exitCode).toBe(0);
  });

  it("ws worktree list returns worktrees including default branch", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "worktree", "list", "myrepo"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ slug: string; type: string }>;
    expect(data.map((w) => w.slug)).toContain("feature-x");
    expect(data.map((w) => w.slug)).toContain("main");
    expect(data.find((w) => w.slug === "main")?.type).toBe("linked");
    expect(data.find((w) => w.slug === "feature-x")?.type).toBe("worktree");
  });

  it("ws worktree list --porcelain: repo\\tslug\\tbranch\\ttype per line", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "worktree", "list", "myrepo", "--porcelain"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    const featureLine = lines.find((l) => l.includes("feature-x"));
    expect(featureLine).toBeDefined();
    if (!featureLine) {
      return;
    }
    const parts = featureLine.split("\t");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("myrepo");
    expect(parts[1]).toBe("feature-x");
    expect(parts[3]).toBe("worktree");
  });

  it("ws worktree remove cleans up symlink and pool entry", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "worktree", "remove", "myrepo", "feature-x"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);

    // Symlink gone
    let gone = false;
    try {
      lstatSync(join(root, "myws", "trees", "myrepo", "feature-x"));
    } catch {
      gone = true;
    }
    expect(gone).toBe(true);

    // Pool entry gone (was last reference)
    expect(existsSync(join(root, "worktrees", "myrepo", "feature-x"))).toBe(false);
  });

  it("ws worktree remove refuses default branch without --force", async () => {
    const r = await runCLI(["ws", "worktree", "remove", "myrepo", "main"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("CANNOT_REMOVE_DEFAULT_BRANCH");
  });

  it("ws worktree add slug collision exits 1", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("SLUG_COLLISION");
  });

  it("ws worktree prune does remove dangling pool symlinks", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/x", "--new"], {
      root,
      cwd: join(root, "myws"),
    });

    // Delete pool entry to make the workspace symlink dangle
    rmSync(join(root, "worktrees", "myrepo", "feature-x"), {
      recursive: true,
      force: true,
    });

    const r = await runCLI(["ws", "worktree", "prune"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);

    const data = r.json?.data as Record<string, unknown>;
    const pruned = data.pruned as Array<{ repo: string; slug: string }>;
    expect(pruned).toHaveLength(1);
    expect(pruned[0].repo).toBe("myrepo");
    expect(pruned[0].slug).toBe("feature-x");

    // Symlink should be gone
    let gone = false;
    try {
      lstatSync(join(root, "myws", "trees", "myrepo", "feature-x"));
    } catch {
      gone = true;
    }
    expect(gone).toBe(true);
  });

  it("pool sharing: two workspaces, same branch, one pool entry", async () => {
    await runCLI(["ws", "add", "otherws"], { root });
    await runCLI(["ws", "repo", "add", "otherws", repoPath], { root });

    // Add from myws first (creates pool entry)
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/shared", "--new"], {
      root,
      cwd: join(root, "myws"),
    });

    // Add from otherws (reuses pool entry)
    const r = await runCLI(["ws", "worktree", "add", "myrepo", "feature/shared"], {
      root,
      cwd: join(root, "otherws"),
    });
    expect(r.exitCode).toBe(0);

    // Both symlinks point to same pool entry
    expect(readlinkSync(join(root, "myws", "trees", "myrepo", "feature-shared"))).toBe(
      "../../../worktrees/myrepo/feature-shared",
    );
    expect(readlinkSync(join(root, "otherws", "trees", "myrepo", "feature-shared"))).toBe(
      "../../../worktrees/myrepo/feature-shared",
    );

    // worktrees.json lists both
    const pool = JSON.parse(readFileSync(join(root, "worktrees.json"), "utf-8"));
    expect(pool.myrepo["feature-shared"]).toContain("myws");
    expect(pool.myrepo["feature-shared"]).toContain("otherws");

    // Remove from myws — pool persists for otherws
    await runCLI(["ws", "worktree", "remove", "myrepo", "feature-shared"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(existsSync(join(root, "worktrees", "myrepo", "feature-shared"))).toBe(true);
    let ws1Gone = false;
    try {
      lstatSync(join(root, "myws", "trees", "myrepo", "feature-shared"));
    } catch {
      ws1Gone = true;
    }
    expect(ws1Gone).toBe(true);

    // Remove from otherws — pool cleaned up
    await runCLI(["ws", "worktree", "remove", "myrepo", "feature-shared"], {
      root,
      cwd: join(root, "otherws"),
    });
    expect(existsSync(join(root, "worktrees", "myrepo", "feature-shared"))).toBe(false);
  });
});

describe("E2E: context inference via cwd", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    repoPath = await createGitRepo(root, "myrepo");
    await runCLI(["ws", "add", "myws"], { root });
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/ctx", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
  });

  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("workspace inferred from cwd at workspace root", async () => {
    const r = await runCLI(["ws", "repo", "list"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).toContain("myrepo");
  });

  it("workspace and repo inferred from cwd inside repo dir", async () => {
    const r = await runCLI(["ws", "worktree", "list"], {
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
    const r = await runCLI(["ws", "repo", "list"], { root, cwd: wtLink });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((r) => r.name)).toContain("myrepo");
  });

  it("ws status inferred from cwd", async () => {
    const r = await runCLI(["ws", "status"], { root, cwd: join(root, "myws") });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, unknown>;
    expect(data.name).toBe("myws");
  });

  it("explicit arg overrides cwd context", async () => {
    await runCLI(["ws", "add", "otherws"], { root });
    // cwd is myws but we explicitly pass otherws
    const r = await runCLI(["ws", "repo", "list", "otherws"], {
      root,
      cwd: join(root, "myws"),
    });
    expect(r.exitCode).toBe(0);
    // otherws has no repos
    const data = r.json?.data as Array<unknown>;
    expect(data).toHaveLength(0);
  });
});

describe("E2E: ws status", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    repoPath = await createGitRepo(root, "myrepo");
    await runCLI(["ws", "add", "myws"], { root });
    await runCLI(["ws", "repo", "add", "myws", repoPath], { root });
  });

  afterEach(() => {
    cleanupTempRoot(root);
  });

  it("ws status returns workspace overview with repos and worktrees", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/s", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "status", "myws"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, unknown>;
    expect(data.name).toBe("myws");
    const repos = data.repos as Array<Record<string, unknown>>;
    expect(repos.length).toBeGreaterThan(0);
    const worktrees = repos[0].worktrees as Array<{ slug: string }>;
    expect(worktrees.map((w) => w.slug)).toContain("feature-s");
  });
});

describe("E2E: deprecation warnings", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });

  afterEach(() => {
    cleanupTempRoot(root);
  });

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

  afterEach(() => {
    cleanupTempRoot(root);
  });

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
    if (r.exitCode !== 0) {
      const errJson = JSON.parse(r.stderr) as { code?: string };
      expect(errJson.code).not.toBe("WORKSPACE_NOT_FOUND");
    }
  });
});
