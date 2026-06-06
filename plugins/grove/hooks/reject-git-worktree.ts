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

async function runHook(input: unknown, extractPayload: PayloadExtractor, denyExitCode: 0 | 2) {
  const payload = extractPayload(input);

  if (payload !== null && (await shouldDenyGitWorktree(payload))) {
    process.stdout.write(`${JSON.stringify(DENY_OUTPUT)}\n`);
    process.exit(denyExitCode);
  }

  process.exit(0);
}

const input = parseHookInput(await Bun.stdin.text());

switch (process.argv[2]) {
  case "codex":
    await runHook(input, extractCodexPreToolUseBashCommand, 0);
    break;
  case "claude":
    await runHook(input, extractClaudePreToolUseBashCommand, 0);
    break;
  case undefined:
  case "legacy":
    await runHook(input, extractPreToolUseBashCommand, 2);
    break;
  default:
    process.exit(0);
}
