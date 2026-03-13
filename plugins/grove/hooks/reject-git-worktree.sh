#!/bin/bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if echo "$COMMAND" | grep -qE '(^|\s)git\s+.*\bworktree\b'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct git worktree commands are not allowed in grove workspaces.",
    "additionalContext": "Use grove skills to manage worktrees:\n- /worktree add [repo] <branch> [--new] — create a worktree\n- /worktree list [repo] — list worktrees\n- /worktree remove [repo] <slug> — remove a worktree\n- /worktree prune — clean up stale worktrees\n\nOr use the create-grove-worktree skill when starting work on a new branch."
  }
}
EOF
  exit 2
fi

exit 0
