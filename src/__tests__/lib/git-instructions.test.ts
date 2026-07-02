import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isPathIgnored, listInstructionFiles } from "../../lib/git";

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

async function git(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", ...args], { cwd, env: { ...process.env, ...GIT_ENV } });
  await proc.exited;
}

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "grove-git-"));
  await git(["init"], repo);
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("listInstructionFiles", () => {
  it("finds tracked and untracked-but-not-ignored instruction files, skipping gitignored dirs", async () => {
    await writeFile(join(repo, "AGENTS.md"), "root");
    await mkdir(join(repo, "src", "lib"), { recursive: true });
    await writeFile(join(repo, "src", "lib", "CLAUDE.md"), "nested untracked");
    await mkdir(join(repo, ".venv"), { recursive: true });
    await writeFile(join(repo, ".venv", "AGENTS.md"), "vendored");
    await writeFile(join(repo, ".gitignore"), ".venv/\n");
    await git(["add", "AGENTS.md"], repo);
    await git(["commit", "-m", "x", "--no-gpg-sign"], repo);

    const result = await listInstructionFiles(repo, GIT_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sort()).toEqual(["AGENTS.md", "src/lib/CLAUDE.md"]);
    }
  });

  it("returns an error for a non-git directory (caller falls back to walk)", async () => {
    const plain = await mkdtemp(join(tmpdir(), "grove-plain-"));
    const result = await listInstructionFiles(plain, GIT_ENV);
    expect(result.ok).toBe(false);
    await rm(plain, { recursive: true, force: true });
  });
});

describe("isPathIgnored", () => {
  it("reports gitignored paths and biases to false on failure", async () => {
    await writeFile(join(repo, ".gitignore"), "node_modules/\n");
    await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
    expect(await isPathIgnored(join(repo, "node_modules", "pkg"), repo, GIT_ENV)).toBe(true);
    expect(await isPathIgnored(join(repo, "src"), repo, GIT_ENV)).toBe(false);
    expect(await isPathIgnored("/nonexistent", "/nonexistent", GIT_ENV)).toBe(false);
  });
});
