import { rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTestDir(): Promise<string> {
  // realpath resolves macOS /var -> /private/var symlink so paths match git output
  const tmp = await mkdtemp(join(tmpdir(), "grove-test-"));
  return realpath(tmp);
}

export async function createTestGitRepo(
  dir: string,
  name: string,
  defaultBranch = "main",
): Promise<string> {
  const repoPath = join(dir, name);
  await mkdir(repoPath, { recursive: true });

  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: dir,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };

  const run = async (args: string[]) => {
    const proc = Bun.spawn(args, {
      cwd: repoPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
    }
  };

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
