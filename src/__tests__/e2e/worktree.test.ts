import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempRoot, createGitRepo, createTempRoot, runCLI } from "./helpers";

describe("E2E: worktree commands", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    [repoPath] = await Promise.all([
      createGitRepo(root, "myrepo"),
      runCLI(["ws", "add", "myws"], { root }),
    ]);
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
    expect(existsSync(join(root, "myws", "trees", "myrepo", "feature-x"))).toBe(false);

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
    expect(existsSync(join(root, "myws", "trees", "myrepo", "feature-x"))).toBe(false);
  });

  it("pool sharing: two workspaces, same branch, one pool entry", async () => {
    await Promise.all([
      runCLI(["ws", "add", "otherws"], { root }),
      // Creates pool entry; independent of otherws workspace setup
      runCLI(["ws", "worktree", "add", "myrepo", "feature/shared", "--new"], {
        root,
        cwd: join(root, "myws"),
      }),
    ]);
    await runCLI(["ws", "repo", "add", "otherws", repoPath], { root });

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
    expect(existsSync(join(root, "myws", "trees", "myrepo", "feature-shared"))).toBe(false);

    // Remove from otherws — pool cleaned up
    await runCLI(["ws", "worktree", "remove", "myrepo", "feature-shared"], {
      root,
      cwd: join(root, "otherws"),
    });
    expect(existsSync(join(root, "worktrees", "myrepo", "feature-shared"))).toBe(false);
  });
});
