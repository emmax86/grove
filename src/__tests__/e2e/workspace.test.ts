import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exists } from "node:fs/promises";
import { join } from "node:path";

import { cleanupTempRoot, createGitRepo, createTempRoot, runCLI } from "./helpers";

describe("E2E: workspace commands", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRoot();
  });
  afterEach(() => cleanupTempRoot(root));

  it("ws add returns name and path, creates directory", async () => {
    const r = await runCLI(["ws", "add", "myws", "--json"], { root });
    expect(r.exitCode).toBe(0);
    expect(r.json?.ok).toBe(true);
    const data = r.json?.data as Record<string, string>;
    expect(data.name).toBe("myws");
    expect(data.path).toBe(join(root, "myws"));
    expect(await exists(join(root, "myws"))).toBe(true);
  });

  it("ws add rejects reserved name 'repos'", async () => {
    const r = await runCLI(["ws", "add", "repos", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("RESERVED_NAME");
  });

  it("ws add rejects reserved name 'worktrees'", async () => {
    const r = await runCLI(["ws", "add", "worktrees", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("RESERVED_NAME");
  });

  it("ws add rejects duplicate workspace", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "add", "myws", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("WORKSPACE_EXISTS");
  });

  it("ws list returns array of workspaces", async () => {
    await Promise.all([
      runCLI(["ws", "add", "ws1"], { root }),
      runCLI(["ws", "add", "ws2"], { root }),
    ]);
    const r = await runCLI(["ws", "list", "--json"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Array<{ name: string }>;
    expect(data.map((w) => w.name)).toContain("ws1");
    expect(data.map((w) => w.name)).toContain("ws2");
    expect(data.map((w) => w.name)).not.toContain("repos");
    expect(data.map((w) => w.name)).not.toContain("worktrees");
  });

  it("ws list --porcelain: name<TAB>path per line, no JSON", async () => {
    await Promise.all([
      runCLI(["ws", "add", "ws1"], { root }),
      runCLI(["ws", "add", "ws2"], { root }),
    ]);
    const r = await runCLI(["ws", "list", "--porcelain"], { root });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    const names = lines.map((l) => l.split("\t")[0]);
    expect(names).toContain("ws1");
    expect(names).toContain("ws2");
    // each line has a TAB
    for (const line of lines) {
      expect(line).toMatch(/\t/);
    }
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
    expect(await exists(join(root, "myws"))).toBe(false);
  });

  it("ws remove non-existent workspace exits 1", async () => {
    const r = await runCLI(["ws", "remove", "ghost", "--json"], { root });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("ws path returns workspace directory path", async () => {
    await runCLI(["ws", "add", "myws"], { root });
    const r = await runCLI(["ws", "path", "myws", "--json"], { root });
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

describe("E2E: ws status", () => {
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

  afterEach(() => cleanupTempRoot(root));

  it("ws status returns workspace overview with repos and worktrees", async () => {
    await runCLI(["ws", "worktree", "add", "myrepo", "feature/s", "--new"], {
      root,
      cwd: join(root, "myws"),
    });
    const r = await runCLI(["ws", "status", "myws", "--json"], { root });
    expect(r.exitCode).toBe(0);
    const data = r.json?.data as Record<string, unknown>;
    expect(data.name).toBe("myws");
    const repos = data.repos as Array<Record<string, unknown>>;
    expect(repos.length).toBeGreaterThan(0);
    const worktrees = repos[0].worktrees as Array<{ slug: string }>;
    expect(worktrees.map((w) => w.slug)).toContain("feature-s");
  });
});
