#!/usr/bin/env bun

import { DENY_OUTPUT, shouldDenyGitWorktree } from "./lib/git-worktree-policy";
import {
  extractClaudePreToolUseBashCommand,
  extractCodexPreToolUseBashCommand,
  extractPreToolUseBashCommand,
  type HookCommandPayload,
  parseHookInput,
} from "./lib/hook-payload";

type PayloadExtractor = (input: unknown) => HookCommandPayload | null;
type DenyOutputTarget = "json" | "stderr";

function writeDenyOutput(target: DenyOutputTarget) {
  if (target === "json") {
    process.stdout.write(`${JSON.stringify(DENY_OUTPUT)}\n`);
    return;
  }

  const { additionalContext, permissionDecisionReason } = DENY_OUTPUT.hookSpecificOutput;
  process.stderr.write(`${permissionDecisionReason}\n\n${additionalContext}\n`);
}

async function runHook(
  input: unknown,
  extractPayload: PayloadExtractor,
  denyExitCode: 0 | 2,
  denyOutputTarget: DenyOutputTarget,
) {
  const payload = extractPayload(input);

  if (payload !== null && (await shouldDenyGitWorktree(payload))) {
    writeDenyOutput(denyOutputTarget);
    process.exit(denyExitCode);
  }

  process.exit(0);
}

const input = parseHookInput(await Bun.stdin.text());

const mode = process.argv[2];

// Each runner has its own documented way to deny a PreToolUse tool call, and
// they differ — do not unify them:
//   codex  — exit 0 with a `hookSpecificOutput.permissionDecision: "deny"` JSON
//            payload on stdout (Codex parses stdout for the decision).
//   claude — exit 2 with the reason on stderr; Claude Code blocks the tool and
//            surfaces stderr to the model. stdout is ignored on exit 2.
//   legacy — exit 2 with the JSON payload on stdout for existing installs that
//            still invoke this script without an adapter mode argument.
switch (mode) {
  case "codex":
    await runHook(input, extractCodexPreToolUseBashCommand, 0, "json");
    break;
  case "claude":
    await runHook(input, extractClaudePreToolUseBashCommand, 2, "stderr");
    break;
  case undefined:
  case "legacy":
    await runHook(input, extractPreToolUseBashCommand, 2, "json");
    break;
  default:
    // The hook matches every Bash command, so an unrecognized mode (a
    // misconfigured install) must fail open rather than block everything.
    // Warn on stderr — only ever reached by a broken config, never normal use.
    process.stderr.write(
      `reject-git-worktree: unknown hook mode ${JSON.stringify(mode)}; expected "codex", "claude", or "legacy". Allowing command.\n`,
    );
    process.exit(0);
}
