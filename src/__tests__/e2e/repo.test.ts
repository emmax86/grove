import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoot, createGitRepo, createTempRoot, runCLI } from "./helpers";

describe("E2E: repo commands", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await createTempRoot();
    [repoPath] = await Promise.all([
      createGitRepo(root, "myrepo"),
      runCLI(["ws", "add", "myws"], { root }),
    ]);
  });

  afterEach(() => cleanupTempRoot(root));

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
