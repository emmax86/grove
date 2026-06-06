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

switch (process.argv[2]) {
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
    process.exit(0);
}
