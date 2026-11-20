import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isGitWorktreeCommand } from "../../hooks/git-worktree-policy";
import { runRejectGitWorktreeHook } from "../../hooks/reject-git-worktree";
import { cleanup, createTestDir } from "../helpers";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const CLI_ENTRY = path.join(REPO_ROOT, "src/cli.ts");
const DENY_REASON = "Direct git worktree commands are not allowed in grove workspaces.";

type HookSpecificOutput = {
  hookEventName: string;
  permissionDecision: string;
  permissionDecisionReason?: string;
  additionalContext: string;
};

type HookInvocationResult = {
  denied: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  hookSpecificOutput?: HookSpecificOutput;
  decision?: string;
  reason?: string;
};

let tempDir: string;
let groveRoot: string;
let groveCwd: string;
let nonGroveCwd: string;

function parseResult(stdout: string, stderr: string, exitCode: number): HookInvocationResult {
  const trimmedStdout = stdout.trim();
  const output = trimmedStdout.length > 0 ? JSON.parse(trimmedStdout) : {};
  const codexDecision =
    output !== null &&
    typeof output === "object" &&
    "hookSpecificOutput" in output &&
    typeof (output as { hookSpecificOutput: unknown }).hookSpecificOutput === "object" &&
    (output as { hookSpecificOutput: unknown }).hookSpecificOutput !== null &&
    "permissionDecision" in (output as { hookSpecificOutput: object }).hookSpecificOutput
      ? (output as { hookSpecificOutput: { permissionDecision: unknown } }).hookSpecificOutput
          .permissionDecision
      : null;
  const antigravityDecision =
    output !== null && typeof output === "object" && "decision" in output
      ? (output as { decision: unknown }).decision
      : null;
  const decision = codexDecision ?? antigravityDecision;
  if (exitCode === 2) {
    return { denied: true, exitCode, stdout, stderr, ...output };
  }
  if (exitCode !== 0) {
    throw new Error(`Hook exited with unexpected code ${exitCode}: ${stderr}`);
  }
  return { denied: decision === "deny", exitCode, stdout, stderr, ...output };
}

async function invokeHookCli(
  input: unknown,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
  cwd?: string,
): Promise<HookInvocationResult> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    GROVE_ROOT: groveRoot,
    ...envOverrides,
  };
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, "hook", "reject-git-worktree", ...args], {
    cwd,
    env,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return parseResult(stdout, stderr, exitCode);
}

async function invokeHookDirect(host: string, input: unknown): Promise<HookInvocationResult> {
  const prevRoot = process.env.GROVE_ROOT;
  process.env.GROVE_ROOT = groveRoot;
  try {
    const result = await runRejectGitWorktreeHook(host, JSON.stringify(input));
    return parseResult(result.stdout, result.stderr, result.exitCode);
  } finally {
    if (prevRoot === undefined) {
      delete process.env.GROVE_ROOT;
    } else {
      process.env.GROVE_ROOT = prevRoot;
    }
  }
}

function invokeCodex(input: unknown) {
  return invokeHookDirect("codex", input);
}

function invokeClaude(input: unknown) {
  return invokeHookDirect("claude", input);
}

function invokeAntigravity(input: unknown) {
  return invokeHookDirect("antigravity", input);
}

function invokeOpenCode(input: unknown) {
  return invokeHookDirect("opencode", input);
}

function opencodeExecuteBeforeCmd(
  command: string,
  directory: string,
  tool = "bash",
  extraInput: Record<string, unknown> = {},
) {
  return {
    tool,
    directory,
    input: { command, ...extraInput },
  };
}

function antigravityPreToolUseCmdInCwd(
  command: string,
  cwd: string,
  toolName = "run_command",
  hookEventName = "PreToolUse",
) {
  return {
    cwd,
    hookEventName,
    toolCall: {
      id: "toolu_01",
      name: toolName,
      args: { CommandLine: command },
    },
  };
}

function requireHookOutput(result: {
  hookSpecificOutput?: HookSpecificOutput;
}): HookSpecificOutput {
  if (result.hookSpecificOutput === undefined) {
    throw new Error("Expected structured hook output");
  }

  return result.hookSpecificOutput;
}

function cmd(command: string) {
  return { tool_input: { command } };
}

function cmdInCwd(command: string, cwd: string) {
  return { cwd, tool_input: { command } };
}

function preToolUseCmdInCwd(command: string, cwd: string, toolName = "Bash") {
  return {
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command },
  };
}

function preToolUseBashCmdInCwd(command: string, cwd: string) {
  return preToolUseCmdInCwd(command, cwd, "Bash");
}

function withCwd(input: unknown, cwd: string): unknown {
  return input !== null && typeof input === "object" ? { ...input, cwd } : input;
}

const DENY_COMMANDS: [string, string][] = [
  ["git worktree list", "git worktree list"],
  ["git worktree add", "git worktree add ../foo feature"],
  ["git worktree remove", "git worktree remove tmp-branch"],
  ["git worktree (bare)", "git worktree"],
  ["git -C <path> worktree list", "git -C /some/path worktree list"],
  ["env var prefix: GIT_DIR=.git git worktree list", "GIT_DIR=.git git worktree list"],
  ["shell separator: echo ok; git worktree list", "echo ok; git worktree list"],
  ["shell &&: echo ok && git worktree list", "echo ok && git worktree list"],
  ['quoted subcommand: git "worktree" list', 'git "worktree" list'],
  ["single-quoted subcommand: git 'worktree' list", "git 'worktree' list"],
  ['quoted env var with spaces: VAR="a b" git worktree list', 'VAR="a b" git worktree list'],
  [
    "git -C -weird-dir worktree list (-C consumes -weird-dir, worktree is subcommand)",
    "git -C -weird-dir worktree list",
  ],
  ["git --no-pager worktree list (--no-pager is a no-value flag)", "git --no-pager worktree list"],
  [
    "git -c user.name=test worktree list (-c consumes key=val)",
    "git -c user.name=test worktree list",
  ],
  [
    "git -C /path -c user.name=test worktree list (multiple VALUE_FLAGS)",
    "git -C /path -c user.name=test worktree list",
  ],
  ["(git worktree list) — subshell grouping", "(git worktree list)"],
  ["{ git worktree list; } — brace grouping", "{ git worktree list; }"],
  ["$(git worktree list) — command substitution", "$(git worktree list)"],
  [
    "GIT_DIR=.git GIT_WORK_TREE=. git worktree list (multiple env vars)",
    "GIT_DIR=.git GIT_WORK_TREE=. git worktree list",
  ],
  ["git log | git worktree list (pipe segment)", "git log | git worktree list"],
  ["git fetch && git worktree list", "git fetch && git worktree list"],
  ["newline-separated: git status\\ngit worktree list", "git status\ngit worktree list"],
];

const ALLOW_COMMANDS: [string, string][] = [
  ["git status", "git status"],
  ["git --version", "git --version"],
  [
    'git commit --allow-empty -m "fix worktree sync bug"',
    'git commit --allow-empty -m "fix worktree sync bug"',
  ],
  ["echo git worktree (git is not the command)", "echo git worktree"],
  ["git -C worktree list (worktree is dir arg to -C)", "git -C worktree list"],
  [
    "git checkout feature/worktree-cleanup (worktree in branch name)",
    "git checkout feature/worktree-cleanup",
  ],
  ["git status && echo worktree (worktree as echo arg)", "git status && echo worktree"],
  [
    'git commit -m "save;git worktree list" (semicolon inside double quotes)',
    'git commit -m "save;git worktree list"',
  ],
  [
    "git commit -m 'save;git worktree list' (semicolon inside single quotes)",
    "git commit -m 'save;git worktree list'",
  ],
  ['git commit -m "a|b" (pipe inside double quotes)', 'git commit -m "a|b"'],
  ["git -C -weird-dir list (dir named -weird-dir, list is subcommand)", "git -C -weird-dir list"],
  ["empty command (fail open)", ""],
  ["cat git-worktree-docs.txt (worktree in filename)", "cat git-worktree-docs.txt"],
  ["grep worktree .git/config (worktree as grep pattern)", "grep worktree .git/config"],
  [
    "git log --all | grep worktree (worktree as grep arg, not git subcommand)",
    "git log --all | grep worktree",
  ],
  [
    "git config worktree.guessRemote true (worktree in config key)",
    "git config worktree.guessRemote true",
  ],
  [
    "git -c alias.wt=worktree status (-c value contains worktree, status is subcommand)",
    "git -c alias.wt=worktree status",
  ],
  [
    "git --git-dir=.git/worktree log (worktree in --git-dir value)",
    "git --git-dir=.git/worktree log",
  ],
  [
    "git --exec-path worktree list (worktree is exec-path value, list is subcommand)",
    "git --exec-path worktree list",
  ],
];

const DENY_CASES: [string, unknown][] = DENY_COMMANDS.map(([label, command]) => [
  label,
  cmd(command),
]);

const ALLOW_CASES: [string, unknown][] = [
  ...ALLOW_COMMANDS.map(([label, command]): [string, unknown] => [label, cmd(command)]),
  ["missing tool_input (fail open)", {}],
];

describe("shared git worktree policy", () => {
  it("detects git worktree shell segments without hook payload parsing", () => {
    expect(isGitWorktreeCommand("git worktree list")).toBe(true);
    expect(isGitWorktreeCommand("echo ok && git worktree list")).toBe(true);
    expect(isGitWorktreeCommand("git status")).toBe(false);
    expect(isGitWorktreeCommand("git -C worktree list")).toBe(false);
  });
});

async function setupAdapterDirs() {
  tempDir = await createTestDir();
  groveRoot = path.join(tempDir, "grove-root");
  groveCwd = path.join(groveRoot, "workspace");
  nonGroveCwd = path.join(tempDir, "plain");

  await mkdir(groveCwd, { recursive: true });
  await mkdir(nonGroveCwd, { recursive: true });
}

function describeSharedPolicy(label: string, invoke: typeof invokeCodex) {
  describe(`shared git worktree policy via the ${label} adapter`, () => {
    beforeEach(setupAdapterDirs);
    afterEach(() => cleanup(tempDir));

    it.each(DENY_CASES)("denies: %s", async (_, input) => {
      const result = await invoke(withCwd(input, groveCwd));
      expect(result.denied).toBe(true);
    });

    it.each(ALLOW_CASES)("allows: %s", async (_, input) => {
      const result = await invoke(withCwd(input, groveCwd));
      expect(result.denied).toBe(false);
    });

    it("allows direct git worktree outside a grove workspace", async () => {
      const result = await invoke(cmdInCwd("git worktree list", nonGroveCwd));
      expect(result.denied).toBe(false);
    });

    it("allows direct git worktree in a workspace.json directory outside GROVE_ROOT", async () => {
      const foreignCwd = path.join(tempDir, "foreign-workspace");
      await mkdir(foreignCwd, { recursive: true });
      await writeFile(path.join(foreignCwd, "workspace.json"), JSON.stringify({ name: "foreign" }));

      const result = await invoke(cmdInCwd("git worktree list", foreignCwd));
      expect(result.denied).toBe(false);
    });

    it("denies direct git worktree for any path under GROVE_ROOT", async () => {
      const nestedCwd = path.join(groveRoot, "scratch", "nested");
      await mkdir(nestedCwd, { recursive: true });

      const result = await invoke(cmdInCwd("git worktree list", nestedCwd));
      expect(result.denied).toBe(true);
    });

    it("denies direct git worktree when GROVE_ROOT is a symlink and cwd is canonical", async () => {
      const realRoot = path.join(tempDir, "real-grove-root");
      const linkedRoot = path.join(tempDir, "linked-grove-root");
      const canonicalCwd = path.join(realRoot, "workspace");
      await mkdir(canonicalCwd, { recursive: true });
      await symlink(realRoot, linkedRoot, "dir");
      groveRoot = linkedRoot;

      const result = await invoke(cmdInCwd("git worktree list", canonicalCwd));
      expect(result.denied).toBe(true);
    });

    it("denies direct git worktree from a linked tree symlink pointing outside GROVE_ROOT", async () => {
      const externalRepo = path.join(tempDir, "external-repo");
      const linkedTree = path.join(groveCwd, "trees", "my-repo", "main");
      await mkdir(externalRepo, { recursive: true });
      await mkdir(path.dirname(linkedTree), { recursive: true });
      await symlink(externalRepo, linkedTree, "dir");

      const result = await invoke(cmdInCwd("git worktree list", linkedTree));
      expect(result.denied).toBe(true);
    });

    it("allows direct git worktree when cwd is missing", async () => {
      const result = await invoke(cmd("git worktree list"));
      expect(result.denied).toBe(false);
    });

    it("allows direct git worktree when GROVE_ROOT does not exist", async () => {
      groveRoot = path.join(tempDir, "missing-grove-root");
      const result = await invoke(cmdInCwd("git worktree list", nonGroveCwd));
      expect(result.denied).toBe(false);
    });

    it("allows direct git worktree when cwd does not exist on disk", async () => {
      const result = await invoke(
        cmdInCwd("git worktree list", path.join(groveRoot, "nonexistent-dir")),
      );
      expect(result.denied).toBe(false);
    });

    it("allows direct git worktree when cwd is only nested under tool_input", async () => {
      const result = await invoke({
        tool_input: { command: "git worktree list", cwd: groveCwd },
      });
      expect(result.denied).toBe(false);
    });

    it("allows PreToolUse payloads for non-Bash tools", async () => {
      const result = await invoke(
        preToolUseCmdInCwd("git worktree list", groveCwd, "mcp__fs__read"),
      );
      expect(result.denied).toBe(false);
    });
  });
}

describeSharedPolicy("Codex", invokeCodex);
describeSharedPolicy("Claude", invokeClaude);

describe("Antigravity reject-git-worktree hook adapter", () => {
  beforeEach(setupAdapterDirs);
  afterEach(() => cleanup(tempDir));

  it.each(DENY_COMMANDS)("denies: %s", async (_, command) => {
    const result = await invokeAntigravity(antigravityPreToolUseCmdInCwd(command, groveCwd));
    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.decision).toBe("deny");
    expect(result.stderr).toBe("");
  });

  it.each(ALLOW_COMMANDS)("allows: %s", async (_, command) => {
    const result = await invokeAntigravity(antigravityPreToolUseCmdInCwd(command, groveCwd));
    expect(result.denied).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("denies with exit 0 and { decision: 'deny', reason } on stdout, leaving stderr empty", async () => {
    const result = await invokeAntigravity(
      antigravityPreToolUseCmdInCwd("git worktree list", groveCwd),
    );

    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain(DENY_REASON);
    expect(result.reason).toContain("/worktree add");
    expect(result.reason).toContain("create-grove-worktree");
    expect(result.stderr).toBe("");
  });

  it("allows git worktree outside GROVE_ROOT", async () => {
    const result = await invokeAntigravity(
      antigravityPreToolUseCmdInCwd("git worktree list", nonGroveCwd),
    );

    expect(result.denied).toBe(false);
    expect(result.stdout).toBe("");
  });

  it("reads toolCall.args.Cwd when top-level cwd is absent (Antigravity IDE/docs payload)", async () => {
    const denied = await invokeAntigravity({
      hookEventName: "PreToolUse",
      toolCall: {
        id: "toolu_02",
        name: "run_command",
        args: { CommandLine: "git worktree list", Cwd: groveCwd },
      },
    });
    expect(denied.denied).toBe(true);
    expect(denied.decision).toBe("deny");

    const allowed = await invokeAntigravity({
      hookEventName: "PreToolUse",
      toolCall: {
        id: "toolu_03",
        name: "run_command",
        args: { CommandLine: "git worktree list", Cwd: nonGroveCwd },
      },
    });
    expect(allowed.denied).toBe(false);
    expect(allowed.stdout).toBe("");
  });

  it("prefers toolCall.args.Cwd over top-level cwd when both are provided", async () => {
    const result = await invokeAntigravity({
      cwd: nonGroveCwd,
      hookEventName: "PreToolUse",
      toolCall: {
        id: "toolu_04",
        name: "run_command",
        args: { CommandLine: "git worktree list", Cwd: groveCwd },
      },
    });

    expect(result.denied).toBe(true);
    expect(result.decision).toBe("deny");
  });

  it("fails open for non-run_command tools, non-PreToolUse events, and missing fields", async () => {
    const nonShell = await invokeAntigravity(
      antigravityPreToolUseCmdInCwd("git worktree list", groveCwd, "read_file"),
    );
    expect(nonShell.denied).toBe(false);
    expect(nonShell.stdout).toBe("");

    const postTool = await invokeAntigravity(
      antigravityPreToolUseCmdInCwd("git worktree list", groveCwd, "run_command", "PostToolUse"),
    );
    expect(postTool.denied).toBe(false);
    expect(postTool.stdout).toBe("");

    const missingCwd = await invokeAntigravity({
      hookEventName: "PreToolUse",
      toolCall: { name: "run_command", args: { CommandLine: "git worktree list" } },
    });
    expect(missingCwd.denied).toBe(false);
    expect(missingCwd.stdout).toBe("");

    const wrongShape = await invokeAntigravity(
      preToolUseBashCmdInCwd("git worktree list", groveCwd),
    );
    expect(wrongShape.denied).toBe(false);
    expect(wrongShape.stdout).toBe("");
  });
});

describe("OpenCode execute.before hook protocol", () => {
  beforeEach(setupAdapterDirs);
  afterEach(() => cleanup(tempDir));

  it("denies git worktree inside GROVE_ROOT with decision JSON on stdout for bash tool", async () => {
    const result = await invokeOpenCode(opencodeExecuteBeforeCmd("git worktree list", groveCwd));

    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain(DENY_REASON);
    expect(result.reason).toContain("/worktree add");
    expect(result.reason).toContain("create-grove-worktree");
    expect(result.stderr).toBe("");
  });

  it("denies git worktree inside GROVE_ROOT for shell tool", async () => {
    const result = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree add ../foo", groveCwd, "shell"),
    );

    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain(DENY_REASON);
  });

  it("allows git worktree outside GROVE_ROOT", async () => {
    const result = await invokeOpenCode(opencodeExecuteBeforeCmd("git worktree list", nonGroveCwd));

    expect(result.denied).toBe(false);
    expect(result.stdout).toBe("");
  });

  it("prefers input.workdir over top-level directory when both are provided", async () => {
    const denied = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", nonGroveCwd, "bash", { workdir: groveCwd }),
    );
    expect(denied.denied).toBe(true);
    expect(denied.decision).toBe("deny");

    const allowed = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "bash", { workdir: nonGroveCwd }),
    );
    expect(allowed.denied).toBe(false);
    expect(allowed.stdout).toBe("");
  });

  it("reads input.workdir when top-level directory is absent", async () => {
    const result = await invokeOpenCode({
      tool: "bash",
      input: { command: "git worktree list", workdir: groveCwd },
    });

    expect(result.denied).toBe(true);
    expect(result.decision).toBe("deny");
  });

  it("resolves relative input.workdir against top-level directory", async () => {
    const subDir = path.join(groveCwd, "packages", "api");
    await mkdir(subDir, { recursive: true });

    const dotDenied = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "shell", { workdir: "." }),
    );
    expect(dotDenied.denied).toBe(true);
    expect(dotDenied.decision).toBe("deny");

    const nestedDenied = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "shell", {
        workdir: "packages/api",
      }),
    );
    expect(nestedDenied.denied).toBe(true);
    expect(nestedDenied.decision).toBe("deny");

    const escapedAllowed = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "shell", {
        workdir: path.relative(groveCwd, nonGroveCwd),
      }),
    );
    expect(escapedAllowed.denied).toBe(false);
    expect(escapedAllowed.stdout).toBe("");
  });

  it("fails open when input.workdir is relative and top-level directory is absent", async () => {
    const result = await invokeOpenCode({
      tool: "shell",
      input: { command: "git worktree list", workdir: "." },
    });

    expect(result.denied).toBe(false);
    expect(result.stdout).toBe("");
  });

  it("accepts args.command when event carries args instead of input", async () => {
    const result = await invokeOpenCode({
      tool: "bash",
      directory: groveCwd,
      args: { command: "git worktree list" },
    });

    expect(result.denied).toBe(true);
    expect(result.decision).toBe("deny");
  });

  it("fails open for non-shell tools, missing fields, and wrong payload shapes", async () => {
    const nonShell = await invokeOpenCode(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "read"),
    );
    expect(nonShell.denied).toBe(false);
    expect(nonShell.stdout).toBe("");

    const missingTool = await invokeOpenCode({
      directory: groveCwd,
      input: { command: "git worktree list" },
    });
    expect(missingTool.denied).toBe(false);
    expect(missingTool.stdout).toBe("");

    const missingDir = await invokeOpenCode({
      tool: "bash",
      input: { command: "git worktree list" },
    });
    expect(missingDir.denied).toBe(false);
    expect(missingDir.stdout).toBe("");

    const wrongShape = await invokeOpenCode(preToolUseBashCmdInCwd("git worktree list", groveCwd));
    expect(wrongShape.denied).toBe(false);
    expect(wrongShape.stdout).toBe("");
  });
});

describe("grove hook reject-git-worktree CLI subprocess", () => {
  beforeEach(setupAdapterDirs);
  afterEach(() => cleanup(tempDir));

  it("runs codex protocol over CLI (--host codex)", async () => {
    const result = await invokeHookCli(preToolUseBashCmdInCwd("git worktree list", groveCwd), [
      "--host",
      "codex",
    ]);

    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(requireHookOutput(result).permissionDecision).toBe("deny");
    expect(requireHookOutput(result).additionalContext).toContain("/worktree");
    expect(result.stderr).toBe("");
  });

  it("runs claude protocol over CLI (--host claude)", async () => {
    const deny = await invokeHookCli(preToolUseBashCmdInCwd("git worktree list", groveCwd), [
      "--host",
      "claude",
    ]);

    expect(deny.denied).toBe(true);
    expect(deny.exitCode).toBe(2);
    expect(deny.stdout).toBe("");
    expect(deny.stderr).toContain(DENY_REASON);
    expect(deny.stderr).toContain("/worktree add");

    const allow = await invokeHookCli(preToolUseBashCmdInCwd("git status", groveCwd), [
      "--host",
      "claude",
    ]);
    expect(allow.denied).toBe(false);
    expect(allow.exitCode).toBe(0);
    expect(allow.stdout).toBe("");
    expect(allow.stderr).toBe("");
  });

  it("runs antigravity protocol over CLI (--host antigravity)", async () => {
    const deny = await invokeHookCli(antigravityPreToolUseCmdInCwd("git worktree list", groveCwd), [
      "--host",
      "antigravity",
    ]);

    expect(deny.denied).toBe(true);
    expect(deny.exitCode).toBe(0);
    expect(deny.decision).toBe("deny");
    expect(deny.reason).toContain(DENY_REASON);
    expect(deny.stderr).toBe("");

    const allow = await invokeHookCli(antigravityPreToolUseCmdInCwd("git status", groveCwd), [
      "--host",
      "antigravity",
    ]);
    expect(allow.denied).toBe(false);
    expect(allow.exitCode).toBe(0);
    expect(allow.stdout).toBe("");
    expect(allow.stderr).toBe("");
  });

  it("runs opencode protocol over CLI (--host opencode)", async () => {
    const deny = await invokeHookCli(opencodeExecuteBeforeCmd("git worktree list", groveCwd), [
      "--host",
      "opencode",
    ]);

    expect(deny.denied).toBe(true);
    expect(deny.exitCode).toBe(0);
    expect(deny.decision).toBe("deny");
    expect(deny.reason).toContain(DENY_REASON);
    expect(deny.stderr).toBe("");

    const allow = await invokeHookCli(opencodeExecuteBeforeCmd("git status", groveCwd), [
      "--host",
      "opencode",
    ]);
    expect(allow.denied).toBe(false);
    expect(allow.exitCode).toBe(0);
    expect(allow.stdout).toBe("");
    expect(allow.stderr).toBe("");
  });

  it("resolves relative OpenCode workdir against payload directory even when spawned outside GROVE_ROOT", async () => {
    const subDir = path.join(groveCwd, "packages", "api");
    await mkdir(subDir, { recursive: true });

    const denyDot = await invokeHookCli(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "shell", { workdir: "." }),
      ["--host", "opencode"],
      {},
      nonGroveCwd,
    );
    expect(denyDot.denied).toBe(true);
    expect(denyDot.decision).toBe("deny");

    const denySubdir = await invokeHookCli(
      opencodeExecuteBeforeCmd("git worktree list", groveCwd, "shell", {
        workdir: "packages/api",
      }),
      ["--host", "opencode"],
      {},
      nonGroveCwd,
    );
    expect(denySubdir.denied).toBe(true);
    expect(denySubdir.decision).toBe("deny");
  });

  it("fails open and warns on an unrecognized or missing --host", async () => {
    const unknown = await invokeHookCli(cmdInCwd("git worktree list", groveCwd), [
      "--host",
      "bogus",
    ]);
    expect(unknown.denied).toBe(false);
    expect(unknown.exitCode).toBe(0);
    expect(unknown.stderr).toContain("unknown hook host");

    const missing = await invokeHookCli(cmdInCwd("git worktree list", groveCwd), []);
    expect(missing.denied).toBe(false);
    expect(missing.exitCode).toBe(0);
    expect(missing.stderr).toContain("unknown hook host");
  });

  it("honors DOTCLAUDE_ROOT fallback and treats empty GROVE_ROOT as unset", async () => {
    const result = await invokeHookCli(
      preToolUseBashCmdInCwd("git worktree list", groveCwd),
      ["--host", "codex"],
      { GROVE_ROOT: "", DOTCLAUDE_ROOT: groveRoot },
    );

    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(requireHookOutput(result).permissionDecision).toBe("deny");
  });
});
