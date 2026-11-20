import { DENY_OUTPUT, shouldDenyGitWorktree } from "./git-worktree-policy";
import {
  extractAntigravityPreToolUseCommand,
  extractClaudePreToolUseBashCommand,
  extractCodexPreToolUseBashCommand,
  extractOpenCodePreToolUseCommand,
  type HookCommandPayload,
  parseHookInput,
} from "./hook-payload";

export type HookHost = "claude" | "codex" | "antigravity" | "opencode";

export interface HookRunResult {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

type PayloadExtractor = (input: unknown) => HookCommandPayload | null;
type DenyOutputTarget = "codex-json" | "decision-json" | "stderr";

function buildDenyOutput(target: DenyOutputTarget): { stdout: string; stderr: string } {
  if (target === "codex-json") {
    return { stdout: `${JSON.stringify(DENY_OUTPUT)}\n`, stderr: "" };
  }

  const { additionalContext, permissionDecisionReason } = DENY_OUTPUT.hookSpecificOutput;
  const reason = `${permissionDecisionReason}\n\n${additionalContext}`;

  if (target === "decision-json") {
    return { stdout: `${JSON.stringify({ decision: "deny", reason })}\n`, stderr: "" };
  }

  return { stdout: "", stderr: `${reason}\n` };
}

async function evaluateHost(
  input: unknown,
  extractPayload: PayloadExtractor,
  denyExitCode: 0 | 2,
  denyOutputTarget: DenyOutputTarget,
  groveRoot?: string,
): Promise<HookRunResult> {
  const payload = extractPayload(input);

  if (payload !== null && (await shouldDenyGitWorktree({ ...payload, groveRoot }))) {
    const { stdout, stderr } = buildDenyOutput(denyOutputTarget);
    return { exitCode: denyExitCode, stdout, stderr };
  }

  return { exitCode: 0, stdout: "", stderr: "" };
}

// Each harness has its own documented way to deny a PreToolUse tool call, and
// they differ — do not unify them:
//   codex       — exit 0 with `hookSpecificOutput.permissionDecision: "deny"`
//                 JSON on stdout (Codex parses stdout for the decision).
//   claude      — exit 2 with the reason on stderr; Claude Code blocks the tool
//                 and surfaces stderr to the model. stdout is ignored on exit 2.
//   antigravity — exit 0 with `{ decision: "deny", reason }` on stdout (empty
//                 stdout on pass-through; never `{}` which fails closed).
//   opencode    — exit 0 with `{ decision: "deny", reason }` on stdout (empty
//                 stdout on pass-through); the OpenCode v2 plugin parses stdout
//                 and throws `new Error(reason)` from `execute.before`.
export async function runRejectGitWorktreeHook(
  host: string | undefined,
  rawInput: string,
  groveRoot?: string,
): Promise<HookRunResult> {
  const input = parseHookInput(rawInput);

  switch (host) {
    case "codex":
      return evaluateHost(input, extractCodexPreToolUseBashCommand, 0, "codex-json", groveRoot);
    case "claude":
      return evaluateHost(input, extractClaudePreToolUseBashCommand, 2, "stderr", groveRoot);
    case "antigravity":
      return evaluateHost(
        input,
        extractAntigravityPreToolUseCommand,
        0,
        "decision-json",
        groveRoot,
      );
    case "opencode":
      return evaluateHost(input, extractOpenCodePreToolUseCommand, 0, "decision-json", groveRoot);
    default:
      // The hook matches every shell command, so a missing or unrecognized host
      // (a misconfigured install) must fail open rather than block everything.
      return {
        exitCode: 0,
        stdout: "",
        stderr: `reject-git-worktree: unknown hook host ${JSON.stringify(host ?? "")}; expected "codex", "claude", "antigravity", or "opencode". Allowing command.\n`,
      };
  }
}
