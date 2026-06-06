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
