import { describe, expect, it } from "bun:test";
import path from "node:path";

const HOOK_SCRIPT = path.resolve(
  import.meta.dir,
  "../../../plugins/grove/hooks/reject-git-worktree.ts",
);

async function invokeScript(input: unknown): Promise<{ denied: boolean }> {
  const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "inherit", // surface errors in test output; avoids pipe deadlock
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode === 2) {
    return { denied: true, ...JSON.parse(stdout.trim()) };
  }
  if (exitCode !== 0) {
    throw new Error(`Hook exited with unexpected code ${exitCode}`);
  }
  return { denied: false };
}

function cmd(command: string) {
  return { tool_input: { command } };
}

const DENY_CASES: [string, unknown][] = [
  ["git worktree list", cmd("git worktree list")],
  ["git worktree add", cmd("git worktree add ../foo feature")],
  ["git worktree remove", cmd("git worktree remove tmp-branch")],
  ["git worktree (bare)", cmd("git worktree")],
  ["git -C <path> worktree list", cmd("git -C /some/path worktree list")],
  ["env var prefix: GIT_DIR=.git git worktree list", cmd("GIT_DIR=.git git worktree list")],
  ["shell separator: echo ok; git worktree list", cmd("echo ok; git worktree list")],
  ["shell &&: echo ok && git worktree list", cmd("echo ok && git worktree list")],
  ['quoted subcommand: git "worktree" list', cmd('git "worktree" list')],
  ["single-quoted subcommand: git 'worktree' list", cmd("git 'worktree' list")],
  ['quoted env var with spaces: VAR="a b" git worktree list', cmd('VAR="a b" git worktree list')],
];

const ALLOW_CASES: [string, unknown][] = [
  ["git status", cmd("git status")],
  ["git --version", cmd("git --version")],
  [
    'git commit --allow-empty -m "fix worktree sync bug"',
    cmd('git commit --allow-empty -m "fix worktree sync bug"'),
  ],
  ["echo git worktree (git is not the command)", cmd("echo git worktree")],
  // KEY: -C consumes "worktree" as a directory arg; "list" is the subcommand
  ["git -C worktree list (worktree is dir arg to -C)", cmd("git -C worktree list")],
  [
    "git checkout feature/worktree-cleanup (worktree in branch name)",
    cmd("git checkout feature/worktree-cleanup"),
  ],
  ["git status && echo worktree (worktree as echo arg)", cmd("git status && echo worktree")],
  ["empty command (fail open)", cmd("")],
  ["missing tool_input (fail open)", {}],
];

describe("reject-git-worktree hook script", () => {
  it.each(DENY_CASES)("denies: %s", async (_, input) => {
    const result = await invokeScript(input);
    expect(result.denied).toBe(true);
  });

  it.each(ALLOW_CASES)("allows: %s", async (_, input) => {
    const result = await invokeScript(input);
    expect(result.denied).toBe(false);
  });

  it("deny output has correct JSON structure", async () => {
    const result = (await invokeScript(cmd("git worktree list"))) as {
      denied: boolean;
      hookSpecificOutput: {
        permissionDecision: string;
        additionalContext: string;
      };
    };
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.additionalContext).toContain("/worktree");
    expect(result.hookSpecificOutput.additionalContext).toContain("create-grove-worktree");
  });
});
