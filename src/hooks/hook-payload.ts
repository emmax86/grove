import { isAbsolute, resolve } from "node:path";

export type HookCommandPayload = {
  command: string;
  cwd: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function parseHookInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export function extractPreToolUseBashCommand(input: unknown): HookCommandPayload | null {
  if (!isRecord(input)) {
    return null;
  }

  if (typeof input.hook_event_name === "string" && input.hook_event_name !== "PreToolUse") {
    return null;
  }

  if (typeof input.tool_name === "string" && input.tool_name !== "Bash") {
    return null;
  }

  if (typeof input.cwd !== "string") {
    return null;
  }

  if (!isRecord(input.tool_input) || typeof input.tool_input.command !== "string") {
    return null;
  }

  return {
    command: input.tool_input.command,
    cwd: input.cwd,
  };
}

// Codex-specific payload parsing belongs here when the Codex schema differs.
export function extractCodexPreToolUseBashCommand(input: unknown): HookCommandPayload | null {
  return extractPreToolUseBashCommand(input);
}

// Claude-specific payload parsing belongs here when the Claude Code schema differs.
export function extractClaudePreToolUseBashCommand(input: unknown): HookCommandPayload | null {
  return extractPreToolUseBashCommand(input);
}

// Antigravity PreToolUse payloads use camelCase protojson fields:
// - IDE/app run_command passes `toolCall.args.Cwd` (command working directory)
// - CLI run_command provides top-level `cwd` (agent working directory)
// Prefer `toolCall.args.Cwd` when present, falling back to top-level `cwd`.
export function extractAntigravityPreToolUseCommand(input: unknown): HookCommandPayload | null {
  if (!isRecord(input)) {
    return null;
  }

  if (typeof input.hookEventName === "string" && input.hookEventName !== "PreToolUse") {
    return null;
  }

  if (!isRecord(input.toolCall)) {
    return null;
  }

  if (typeof input.toolCall.name === "string" && input.toolCall.name !== "run_command") {
    return null;
  }

  if (!isRecord(input.toolCall.args) || typeof input.toolCall.args.CommandLine !== "string") {
    return null;
  }

  const cwd =
    typeof input.toolCall.args.Cwd === "string" && input.toolCall.args.Cwd.length > 0
      ? input.toolCall.args.Cwd
      : typeof input.cwd === "string"
        ? input.cwd
        : null;
  if (cwd === null) {
    return null;
  }

  return {
    command: input.toolCall.args.CommandLine,
    cwd,
  };
}

const OPENCODE_SHELL_TOOLS = new Set(["bash", "shell"]);

function firstNonEmptyString(values: unknown[]): string | null {
  return (
    values.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    ) ?? null
  );
}

// OpenCode v2 `execute.before` payloads provide `{ tool, input, directory }`
// (or `{ tool, args, directory }`), where shell tools are named `bash` or
// `shell`. Prefer an explicit per-command `workdir`/`cwd` over top-level
// `directory`/`cwd`, resolving relative per-command paths against the payload's
// top-level directory rather than the hook subprocess's working directory.
export function extractOpenCodePreToolUseCommand(input: unknown): HookCommandPayload | null {
  if (!isRecord(input)) {
    return null;
  }

  if (typeof input.tool !== "string" || !OPENCODE_SHELL_TOOLS.has(input.tool)) {
    return null;
  }

  const toolInput = isRecord(input.input) ? input.input : isRecord(input.args) ? input.args : null;
  if (toolInput === null || typeof toolInput.command !== "string") {
    return null;
  }

  const baseDir = firstNonEmptyString([input.directory, input.cwd]);
  const commandDir = firstNonEmptyString([toolInput.workdir, toolInput.cwd]);

  let cwd: string | null;
  if (commandDir !== null) {
    if (isAbsolute(commandDir)) {
      cwd = commandDir;
    } else if (baseDir !== null) {
      cwd = resolve(baseDir, commandDir);
    } else {
      cwd = null;
    }
  } else {
    cwd = baseDir;
  }

  if (cwd === null) {
    return null;
  }

  return {
    command: toolInput.command,
    cwd,
  };
}
