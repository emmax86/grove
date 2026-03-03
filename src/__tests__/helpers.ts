import { rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTestDir(): Promise<string> {
  // realpath resolves macOS /var -> /private/var symlink so paths match git output
  const tmp = await mkdtemp(join(tmpdir(), "grove-test-"));
  return await realpath(tmp);
}

export async function createTestGitRepo(
  dir: string,
  name: string,
  defaultBranch = "main",
): Promise<string> {
  const repoPath = join(dir, name);
  await mkdir(repoPath, { recursive: true });

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: dir,
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

  // Create initial commit so HEAD is valid
  const readmePath = join(repoPath, "README.md");
  await Bun.write(readmePath, `# ${name}\n`);
  await run(["git", "add", "."]);
  await run(["git", "commit", "-m", "Initial commit"]);

  return repoPath;
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
};

/** Run a git command. Returns trimmed stdout. Throws on non-zero exit. */
export async function spawnProc(
  args: string[],
  cwd: string | undefined,
  env: Record<string, string | undefined>,
): Promise<string> {
  const proc = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

/**
 * Create a minimal git repo with HEAD detached to the initial commit.
 * Useful for testing paths where getDefaultBranch (symbolic-ref) fails.
 */
export async function createDetachedGitRepo(parentDir: string, name: string): Promise<string> {
  const repoPath = join(parentDir, name);
  await mkdir(repoPath, { recursive: true });
  const env = { ...process.env, ...GIT_ENV, HOME: parentDir };

  await spawnProc(["git", "init", "-b", "main", repoPath], undefined, env);
  await spawnProc(["git", "-C", repoPath, "config", "user.email", "test@test.com"], undefined, env);
  await spawnProc(["git", "-C", repoPath, "config", "user.name", "Test"], undefined, env);
  await Bun.write(join(repoPath, "README"), "x");
  await spawnProc(["git", "-C", repoPath, "add", "."], undefined, env);
  await spawnProc(["git", "-C", repoPath, "commit", "-m", "init"], undefined, env);
  const sha = await spawnProc(["git", "-C", repoPath, "rev-parse", "HEAD"], undefined, env);
  await Bun.write(join(repoPath, ".git", "HEAD"), `${sha}\n`);

  return repoPath;
}
