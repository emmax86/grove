import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type HookCallback, query } from "@anthropic-ai/claude-agent-sdk";

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const HOOK_SCRIPT = path.resolve(
  import.meta.dir,
  "../../../plugins/grove/hooks/reject-git-worktree.sh",
);

async function git(args: string[], cwd: string): Promise<void> {
  await Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
}

async function invokeScript(input: unknown): Promise<{ denied: boolean }> {
  const proc = Bun.spawn(["bash", HOOK_SCRIPT], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode === 2) {
    return { denied: true, ...JSON.parse(stdout.trim()) };
  }
  return { denied: false };
}

function makeHook(): { hook: HookCallback; denied: () => boolean } {
  let denied = false;
  const hook: HookCallback = async (input) => {
    const result = await invokeScript(input);
    if (result.denied) {
      denied = true;
    }
    return result.denied ? result : {};
  };
  return { hook, denied: () => denied };
}

async function runQuery(prompt: string, hook: HookCallback, cwd: string): Promise<void> {
  for await (const _ of query({
    prompt,
    options: {
      allowedTools: ["Bash(*)"],
      permissionMode: "acceptEdits",
      cwd,
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [hook] }],
      },
    },
  })) {
  }
}

// Cannot run inside a Claude Code session — the SDK spawns claude internally.
// Tests are skipped automatically when CLAUDECODE env var is set (e.g. during development).
// They run normally in CI and plain terminals.
describe.if(!process.env.CLAUDECODE)("reject-git-worktree hook", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), "grove-hook-test-"));
    await git(["init"], repoDir);
    await git(["commit", "--allow-empty", "-m", "init"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("hook denies git worktree list", async () => {
    const { hook, denied } = makeHook();
    await runQuery("Use the Bash tool to run: git worktree list", hook, repoDir);
    expect(denied()).toBe(true);
  }, 60_000);

  it("hook denies git worktree add", async () => {
    const { hook, denied } = makeHook();
    await runQuery(
      "Use the Bash tool to run: git worktree add ../tmp-branch tmp-branch",
      hook,
      repoDir,
    );
    expect(denied()).toBe(true);
  }, 60_000);

  it("hook denies git worktree remove", async () => {
    const { hook, denied } = makeHook();
    await runQuery("Use the Bash tool to run: git worktree remove tmp-branch", hook, repoDir);
    expect(denied()).toBe(true);
  }, 60_000);

  it("hook denies git -C <path> worktree list", async () => {
    const { hook, denied } = makeHook();
    await runQuery(`Use the Bash tool to run: git -C ${repoDir} worktree list`, hook, repoDir);
    expect(denied()).toBe(true);
  }, 60_000);

  it("hook allows git --version", async () => {
    const { hook, denied } = makeHook();
    await runQuery("Use the Bash tool to run: git --version", hook, repoDir);
    expect(denied()).toBe(false);
  }, 60_000);

  it("hook allows git status", async () => {
    const { hook, denied } = makeHook();
    await runQuery("Use the Bash tool to run: git status", hook, repoDir);
    expect(denied()).toBe(false);
  }, 60_000);

  it("hook allows git commit with worktree in message", async () => {
    const { hook, denied } = makeHook();
    await runQuery(
      'Use the Bash tool to run: git commit --allow-empty -m "fix worktree sync bug"',
      hook,
      repoDir,
    );
    expect(denied()).toBe(false);
  }, 60_000);
});
