import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanup, createTestDir } from "../helpers";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../../../plugins/grove");
const CODEX_PLUGIN_MANIFEST = path.join(PLUGIN_ROOT, ".codex-plugin/plugin.json");
const CODEX_HOOKS_JSON = path.join(PLUGIN_ROOT, "hooks/hooks.json");
const LEGACY_CODEX_HOOKS_JSON = path.join(PLUGIN_ROOT, "hooks.json");
const HOOK_SCRIPT = path.join(PLUGIN_ROOT, "hooks/reject-git-worktree.ts");

let tempDir: string;
let groveRoot: string;
let groveCwd: string;
let nonGroveCwd: string;

async function invokeScript(input: unknown): Promise<{ denied: boolean }> {
  const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT], {
    env: { ...process.env, GROVE_ROOT: groveRoot },
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

function cmdInCwd(command: string, cwd: string) {
  return { cwd, tool_input: { command } };
}

function withCwd(input: unknown, cwd: string): unknown {
  return input !== null && typeof input === "object" ? { ...input, cwd } : input;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
  // subshell and brace grouping — ( and { are segment boundaries
  ["(git worktree list) — subshell grouping", cmd("(git worktree list)")],
  ["{ git worktree list; } — brace grouping", cmd("{ git worktree list; }")],
  // command substitution — ( is a boundary so the inner segment is detected
  ["$(git worktree list) — command substitution", cmd("$(git worktree list)")],
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
  // --exec-path consumes next token as value; subcommand is list, not worktree
  [
    "git --exec-path worktree list (worktree is exec-path value, list is subcommand)",
    cmd("git --exec-path worktree list"),
  ],
];

describe("Codex plugin hook layout", () => {
  it("uses default bundled hook discovery with PLUGIN_ROOT", async () => {
    const manifest = JSON.parse(await readFile(CODEX_PLUGIN_MANIFEST, "utf8")) as {
      hooks?: unknown;
    };
    expect(manifest.hooks).toBeUndefined();
    expect(await exists(CODEX_HOOKS_JSON)).toBe(true);
    expect(await exists(LEGACY_CODEX_HOOKS_JSON)).toBe(false);

    const hookConfig = JSON.parse(await readFile(CODEX_HOOKS_JSON, "utf8")) as {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                command: string;
              },
            ];
          },
        ];
      };
    };
    expect(hookConfig.hooks.PreToolUse).toHaveLength(1);
    expect(hookConfig.hooks.PreToolUse[0].hooks).toHaveLength(1);
    const command = hookConfig.hooks.PreToolUse[0].hooks[0].command;
    const pluginRootVar = "$" + "{PLUGIN_ROOT}";
    expect(command).toBe(`bun run ${pluginRootVar}/hooks/reject-git-worktree.ts`);
    expect(JSON.stringify(hookConfig)).not.toContain("CODEX_PLUGIN_ROOT");
  });
});

describe("reject-git-worktree hook script", () => {
  beforeEach(async () => {
    tempDir = await createTestDir();
    groveRoot = path.join(tempDir, "grove-root");
    groveCwd = path.join(groveRoot, "workspace");
    nonGroveCwd = path.join(tempDir, "plain");

    await mkdir(groveCwd, { recursive: true });
    await mkdir(nonGroveCwd, { recursive: true });
  });

  afterEach(() => cleanup(tempDir));

  it.each(DENY_CASES)("denies: %s", async (_, input) => {
    const result = await invokeScript(withCwd(input, groveCwd));
    expect(result.denied).toBe(true);
  });

  it.each(ALLOW_CASES)("allows: %s", async (_, input) => {
    const result = await invokeScript(withCwd(input, groveCwd));
    expect(result.denied).toBe(false);
  });

  it("allows direct git worktree outside a grove workspace", async () => {
    const result = await invokeScript(cmdInCwd("git worktree list", nonGroveCwd));

    expect(result.denied).toBe(false);
  });

  it("allows direct git worktree in a workspace.json directory outside GROVE_ROOT", async () => {
    const foreignCwd = path.join(tempDir, "foreign-workspace");
    await mkdir(foreignCwd, { recursive: true });
    await writeFile(path.join(foreignCwd, "workspace.json"), JSON.stringify({ name: "foreign" }));

    const result = await invokeScript(cmdInCwd("git worktree list", foreignCwd));

    expect(result.denied).toBe(false);
  });

  it("denies direct git worktree for any path under GROVE_ROOT", async () => {
    const nestedCwd = path.join(groveRoot, "scratch", "nested");
    await mkdir(nestedCwd, { recursive: true });

    const result = await invokeScript(cmdInCwd("git worktree list", nestedCwd));

    expect(result.denied).toBe(true);
  });

  it("denies direct git worktree when GROVE_ROOT is a symlink and cwd is canonical", async () => {
    const realRoot = path.join(tempDir, "real-grove-root");
    const linkedRoot = path.join(tempDir, "linked-grove-root");
    const canonicalCwd = path.join(realRoot, "workspace");
    await mkdir(canonicalCwd, { recursive: true });
    await symlink(realRoot, linkedRoot, "dir");
    groveRoot = linkedRoot;

    const result = await invokeScript(cmdInCwd("git worktree list", canonicalCwd));

    expect(result.denied).toBe(true);
  });

  it("allows direct git worktree when cwd is missing", async () => {
    const result = await invokeScript(cmd("git worktree list"));

    expect(result.denied).toBe(false);
  });

  it("allows direct git worktree when GROVE_ROOT does not exist", async () => {
    groveRoot = path.join(tempDir, "missing-grove-root");

    const result = await invokeScript(cmdInCwd("git worktree list", nonGroveCwd));

    expect(result.denied).toBe(false);
  });

  it("allows direct git worktree when cwd does not exist on disk", async () => {
    const result = await invokeScript(
      cmdInCwd("git worktree list", path.join(groveRoot, "nonexistent-dir")),
    );

    expect(result.denied).toBe(false);
  });

  it("allows direct git worktree when cwd is only nested under tool_input", async () => {
    const result = await invokeScript({
      tool_input: { command: "git worktree list", cwd: groveCwd },
    });

    expect(result.denied).toBe(false);
  });

  // This validates test fixture plumbing: cases wrapped with withCwd must use the wrapper cwd.
  it("withCwd overrides an existing top-level cwd", async () => {
    const result = await invokeScript(
      withCwd(cmdInCwd("git worktree list", nonGroveCwd), groveCwd),
    );

    expect(result.denied).toBe(true);
  });

  it("deny output has correct JSON structure", async () => {
    const result = (await invokeScript(cmdInCwd("git worktree list", groveCwd))) as {
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
