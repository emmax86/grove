#!/usr/bin/env bun

import { DENY_OUTPUT, shouldDenyGitWorktree } from "./lib/git-worktree-policy";
import { extractPreToolUseBashCommand, parseHookInput } from "./lib/hook-payload";

const payload = extractPreToolUseBashCommand(parseHookInput(await Bun.stdin.text()));

if (payload !== null && (await shouldDenyGitWorktree(payload))) {
  process.stdout.write(`${JSON.stringify(DENY_OUTPUT)}\n`);
  process.exit(0);
}

process.exit(0);
