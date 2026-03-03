---
description: Manage git worktrees inside a grove workspace (add, list, remove, prune)
argument-hint: <subcommand> [repo] [args...]
allowed-tools: Bash(grove ws worktree add:*), Bash(grove ws worktree list:*), Bash(grove ws worktree remove:*), Bash(grove ws worktree prune:*)
---

Run the grove worktree subcommand with the provided arguments:

```
grove ws worktree $ARGUMENTS
```

## Subcommands

- `add [repo] <branch> [--new] [--from <base>]` — create a worktree; `--new` creates the branch
- `list [repo] [--porcelain]` — list worktrees for a repo
- `remove [repo] <slug> [--force]` — remove a worktree
- `prune` — remove dangling pool symlinks for all repos in the workspace

The `repo` argument is inferred from `$PWD` when omitted.

Run the command and report the result. If it fails, show the error message.

## Notes

- Branch names are slugified (`/` → `-`) when used as directory names
- Default-branch worktrees (created by `repo add`) cannot be removed via `worktree remove` — use `repo remove` instead
- `prune` runs automatically as part of `ws sync`
- The pool allows multiple workspaces to share the same git worktree
