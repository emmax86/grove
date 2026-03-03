import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnProc } from "../helpers";

const CLI = join(import.meta.dir, "../../cli.ts");

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  json?: Record<string, unknown>;
}

export async function runCLI(
  args: string[],
  options: {
    cwd?: string;
    root?: string;
    pwd?: string;
    env?: Record<string, string>;
  } = {},
): Promise<RunResult> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GROVE_ROOT: options.root ?? "",
    // PWD lets context inference use the logical (symlink-preserving) path.
    // Falls back to cwd if not explicitly overridden.
    PWD: options.pwd ?? options.cwd ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
    ...options.env,
  };

  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: options.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [rawStdout, rawStderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const stdout = rawStdout.trim();
  const stderr = rawStderr.trim();

  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(stdout);
  } catch {
    /* not JSON */
  }

  return { stdout, stderr, exitCode, json };
}

export async function createTempRoot(): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "grove-e2e-"));
  return await realpath(tmp);
}

export async function cleanupTempRoot(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore — best-effort teardown
  }
}

/** Create a minimal git repo with an initial commit and return its path. */
export async function createGitRepo(
  parentDir: string,
  name: string,
  defaultBranch = "main",
): Promise<string> {
  const repoPath = join(parentDir, name);
  await mkdir(repoPath, { recursive: true });

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: parentDir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };

  const run = (args: string[]) => spawnProc(args, repoPath, env);

  await run(["git", "init", "-b", defaultBranch]);
  await run(["git", "config", "user.email", "test@test.com"]);
  await run(["git", "config", "user.name", "Test"]);
  await Bun.write(join(repoPath, "README.md"), `# ${name}\n`);
  await run(["git", "add", "."]);
  await run(["git", "commit", "-m", "Initial commit"]);

  return repoPath;
}
