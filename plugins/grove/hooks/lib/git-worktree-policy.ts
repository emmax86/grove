import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const DENY_OUTPUT = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Direct git worktree commands are not allowed in grove workspaces.",
    additionalContext:
      "Use grove skills to manage worktrees:\n" +
      "- /worktree add [repo] <branch> [--new] - create a worktree\n" +
      "- /worktree list [repo] - list worktrees\n" +
      "- /worktree remove [repo] <slug> - remove a worktree\n" +
      "- /worktree prune - clean up stale worktrees\n\n" +
      "Or use the create-grove-worktree skill when starting work on a new branch.",
  },
};

const VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
]);

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
          i++;
        }
        current += command[i++];
      }
      i++;
    } else if (ch === "\\" && i + 1 < command.length) {
      current += command[++i];
      i++;
    } else if (/[;&|\n(){}]/.test(ch)) {
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

  while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) {
    i++;
  }

  if (tokens[i] !== "git") {
    return false;
  }
  i++;

  while (i < tokens.length && tokens[i].startsWith("-")) {
    const flag = tokens[i++];
    if (VALUE_FLAGS.has(flag) && i < tokens.length) {
      i++;
    }
  }

  return tokens[i] === "worktree";
}

async function tryRealpath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

export function defaultGroveRoot(): string {
  return resolve(process.env.GROVE_ROOT ?? join(process.env.HOME ?? "/tmp", "grove-workspaces"));
}

export function isGitWorktreeCommand(command: string): boolean {
  return tokenizeIntoSegments(command).some(isGitWorktreeSegment);
}

export async function isInsideGroveWorkspace(
  cwd: string,
  groveRoot = defaultGroveRoot(),
): Promise<boolean> {
  const realRoot = await tryRealpath(groveRoot);
  const realCwd = await tryRealpath(cwd);
  if (realRoot === null || realCwd === null) {
    return false;
  }

  const rel = relative(realRoot, realCwd);

  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

export async function shouldDenyGitWorktree(input: {
  command: string;
  cwd: string;
  groveRoot?: string;
}): Promise<boolean> {
  return (
    isGitWorktreeCommand(input.command) &&
    (await isInsideGroveWorkspace(input.cwd, input.groveRoot ?? defaultGroveRoot()))
  );
}
