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
  // VALUE_FLAGS consume next token even when it starts with "-"
  [
    "git -C -weird-dir worktree list (-C consumes -weird-dir, worktree is subcommand)",
    cmd("git -C -weird-dir worktree list"),
  ],
  [
    "git --no-pager worktree list (--no-pager is a no-value flag)",
    cmd("git --no-pager worktree list"),
  ],
  // -c consumes key=value pair, worktree is still the subcommand
  [
    "git -c user.name=test worktree list (-c consumes key=val)",
    cmd("git -c user.name=test worktree list"),
  ],
  // stacked VALUE_FLAGS — -C consumes path, -c consumes key=val, worktree is subcommand
  [
    "git -C /path -c user.name=test worktree list (multiple VALUE_FLAGS)",
    cmd("git -C /path -c user.name=test worktree list"),
  ],
  // multiple env var assignments before git
  [
    "GIT_DIR=.git GIT_WORK_TREE=. git worktree list (multiple env vars)",
    cmd("GIT_DIR=.git GIT_WORK_TREE=. git worktree list"),
  ],
  // pipe creates a new segment containing git worktree
  ["git log | git worktree list (pipe segment)", cmd("git log | git worktree list")],
  // && creates a new segment
  ["git fetch && git worktree list", cmd("git fetch && git worktree list")],
  // newline-separated commands
  ["newline-separated: git status\\ngit worktree list", cmd("git status\ngit worktree list")],
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
  // operator inside quoted string must not create a false segment boundary
  [
    'git commit -m "save;git worktree list" (semicolon inside double quotes)',
    cmd('git commit -m "save;git worktree list"'),
  ],
  [
    "git commit -m 'save;git worktree list' (semicolon inside single quotes)",
    cmd("git commit -m 'save;git worktree list'"),
  ],
  ['git commit -m "a|b" (pipe inside double quotes)', cmd('git commit -m "a|b"')],
  // VALUE_FLAGS consume next token even when it starts with "-"
  [
    "git -C -weird-dir list (dir named -weird-dir, list is subcommand)",
    cmd("git -C -weird-dir list"),
  ],
  ["empty command (fail open)", cmd("")],
  ["missing tool_input (fail open)", {}],
  // "worktree" appears only as a filename argument — not a git subcommand
  ["cat git-worktree-docs.txt (worktree in filename)", cmd("cat git-worktree-docs.txt")],
  ["grep worktree .git/config (worktree as grep pattern)", cmd("grep worktree .git/config")],
  // worktree appears after a pipe but in a non-git command
  [
    "git log --all | grep worktree (worktree as grep arg, not git subcommand)",
    cmd("git log --all | grep worktree"),
  ],
  // config key contains worktree but git subcommand is config, not worktree
  [
    "git config worktree.guessRemote true (worktree in config key)",
    cmd("git config worktree.guessRemote true"),
  ],
  // -c value contains the word worktree — must not misidentify as subcommand
  [
    "git -c alias.wt=worktree status (-c value contains worktree, status is subcommand)",
    cmd("git -c alias.wt=worktree status"),
  ],
  // git dir flag with worktree in the path — not a subcommand
  [
    "git --git-dir=.git/worktree log (worktree in --git-dir value)",
    cmd("git --git-dir=.git/worktree log"),
  ],
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
