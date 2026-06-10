#!/usr/bin/env bun

import { DENY_OUTPUT, shouldDenyGitWorktree } from "./lib/git-worktree-policy";
import {
  extractClaudePreToolUseBashCommand,
  extractCodexPreToolUseBashCommand,
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

// The bundled hooks/hooks.json is auto-discovered by BOTH Claude Code and Codex
// from the plugin root, so it runs the same command under each host and cannot
// pass a host-specific mode argument. Detect the host from the plugin-root env
// var each runner sets: Claude Code sets CLAUDE_PLUGIN_ROOT, Codex sets
// PLUGIN_ROOT. An explicit argv mode still wins for direct invocation.
//
// A real hook invocation always has one of those vars set (the hooks.json
// command needs one to resolve this script's path), so the no-var fallback only
// happens for a manual/anomalous invocation. Default it to the Claude protocol:
// exit 2 + stderr is the strongest, most broadly-understood deny, so an
// undetectable host still blocks rather than silently allowing.
function resolveMode(argMode: string | undefined): string {
  if (argMode !== undefined) {
    return argMode;
  }
  if (process.env.PLUGIN_ROOT !== undefined && process.env.CLAUDE_PLUGIN_ROOT === undefined) {
    return "codex";
  }
  return "claude";
}

const mode = resolveMode(process.argv[2]);

// Each runner has its own documented way to deny a PreToolUse tool call, and
// they differ — do not unify them:
//   codex  — exit 0 with a `hookSpecificOutput.permissionDecision: "deny"` JSON
//            payload on stdout (Codex parses stdout for the decision).
//   claude — exit 2 with the reason on stderr; Claude Code blocks the tool and
//            surfaces stderr to the model. stdout is ignored on exit 2.
switch (mode) {
  case "codex":
    await runHook(input, extractCodexPreToolUseBashCommand, 0, "json");
    break;
  case "claude":
    await runHook(input, extractClaudePreToolUseBashCommand, 2, "stderr");
    break;
  default:
    // The hook matches every Bash command, so an unrecognized explicit mode (a
    // misconfigured install) must fail open rather than block everything.
    // Warn on stderr — only ever reached by a broken config, never normal use.
    process.stderr.write(
      `reject-git-worktree: unknown hook mode ${JSON.stringify(mode)}; expected "codex" or "claude". Allowing command.\n`,
    );
    process.exit(0);
}
