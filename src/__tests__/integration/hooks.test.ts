import { describe, expect, it } from "bun:test";
import path from "node:path";

const HOOK_SCRIPT = path.resolve(
  import.meta.dir,
  "../../../plugins/grove/hooks/reject-git-worktree.sh",
);

async function runHook(
  script: string,
  input: object,
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bash", script], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdout.trim() };
}

describe("reject-git-worktree hook", () => {
  // Cycle 1: basic allow/deny
  it("rejects git worktree add command", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git worktree add ../foo feature" },
    });
    expect(result.exitCode).toBe(2);
  });

  it("allows non-worktree git commands", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git status" },
    });
    expect(result.exitCode).toBe(0);
  });

  // Cycle 2: output JSON structure
  it("returns deny JSON with permissionDecision and additionalContext", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git worktree list" },
    });
    expect(result.exitCode).toBe(2);
    const json = JSON.parse(result.stdout);
    expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(json.hookSpecificOutput.additionalContext).toContain("/worktree");
    expect(json.hookSpecificOutput.additionalContext).toContain("create-grove-worktree");
  });

  // Cycle 3: edge cases — git flags before worktree
  it("rejects git -C /some/path worktree list", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git -C /some/path worktree list" },
    });
    expect(result.exitCode).toBe(2);
  });

  it("rejects git with extra spaces before worktree", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git  worktree add" },
    });
    expect(result.exitCode).toBe(2);
  });

  it("rejects bare git worktree with no trailing args", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git worktree" },
    });
    expect(result.exitCode).toBe(2);
  });

  // Cycle 4: no false positives
  it("allows echo worktree", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "echo worktree" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("allows cat git-worktree.txt", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "cat git-worktree.txt" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("allows git log --oneline", async () => {
    const result = await runHook(HOOK_SCRIPT, {
      tool_input: { command: "git log --oneline" },
    });
    expect(result.exitCode).toBe(0);
  });
});
