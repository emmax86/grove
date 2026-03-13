#!/usr/bin/env bun
// PreToolUse hook: deny direct `git worktree` commands in grove workspaces.
//
// Strategy: tokenize the command in a single quote-aware pass that simultaneously
// handles shell operators (;  &  |  newline) as segment boundaries and strips
// single/double quotes with backslash escapes. Each segment is then walked
// structurally to check for a git worktree invocation.
//
// Known limitation: backtick command substitution (` `git worktree list` `),
// fd-redirect prefixes (`1>&2 git worktree list`), and heredoc-embedded calls
// are not detected. Full shell parsing is out of scope.
// Note: `$(git worktree list)` IS caught because `(` is a segment boundary.

const DENY_OUTPUT = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Direct git worktree commands are not allowed in grove workspaces.",
    additionalContext:
      "Use grove skills to manage worktrees:\n" +
      "- /worktree add [repo] <branch> [--new] — create a worktree\n" +
      "- /worktree list [repo] — list worktrees\n" +
      "- /worktree remove [repo] <slug> — remove a worktree\n" +
      "- /worktree prune — clean up stale worktrees\n\n" +
      "Or use the create-grove-worktree skill when starting work on a new branch.",
  },
};

// Git global options that consume the next token as a separate value argument.
const VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
]);

// Tokenize a shell command into segments split on operators (;  &  |  newline),
// respecting single/double quoting and backslash escapes so operators inside
// quoted strings are not treated as segment boundaries.
function tokenizeIntoSegments(command: string): string[][] {
  const segments: string[][] = [[]];
  let current = "";
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < command.length && command[i] !== quote) {
        if (quote === '"' && command[i] === "\\" && i + 1 < command.length) {
          i++; // backslash escape inside double-quoted string
        }
        current += command[i++];
      }
      i++; // skip closing quote
    } else if (ch === "\\" && i + 1 < command.length) {
      current += command[++i];
      i++;
    } else if (/[;&|\n(){}]/.test(ch)) {
      // operator or grouping character outside quotes — flush current token and start a new segment
      if (current.length > 0) {
        segments[segments.length - 1].push(current);
        current = "";
      }
      segments.push([]);
      i++;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        segments[segments.length - 1].push(current);
        current = "";
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0) {
    segments[segments.length - 1].push(current);
  }

  return segments;
}

function isGitWorktreeSegment(tokens: string[]): boolean {
  let i = 0;

  // Skip leading env var assignments (VAR=value).
  while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) {
    i++;
  }

  // First non-env token must be exactly "git".
  if (tokens[i] !== "git") {
    return false;
  }
  i++;

  // Skip git global flags, consuming their value argument where applicable.
  // Always consume the next token for VALUE_FLAGS regardless of whether it
  // starts with "-", since flag values can legitimately start with "-"
  // (e.g. a directory named "-c" passed to -C).
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const flag = tokens[i++];
    if (VALUE_FLAGS.has(flag) && i < tokens.length) {
      i++; // consume the flag's value
    }
  }

  // The next token must be exactly the "worktree" subcommand.
  return tokens[i] === "worktree";
}

function extractCommand(input: unknown): string {
  if (
    input !== null &&
    typeof input === "object" &&
    "tool_input" in input &&
    typeof (input as { tool_input: unknown }).tool_input === "object" &&
    (input as { tool_input: unknown }).tool_input !== null &&
    "command" in (input as { tool_input: object }).tool_input &&
    typeof (input as { tool_input: { command: unknown } }).tool_input.command === "string"
  ) {
    return (input as { tool_input: { command: string } }).tool_input.command;
  }
  return "";
}

let input: unknown;
try {
  input = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0); // malformed input — fail open
}

const command = extractCommand(input);
const denied = tokenizeIntoSegments(command).some(isGitWorktreeSegment);

if (denied) {
  process.stdout.write(`${JSON.stringify(DENY_OUTPUT)}\n`);
  process.exit(2);
}

process.exit(0);
