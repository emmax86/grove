---
description: Manage grove workspaces (add, list, remove, status, path, sync)
argument-hint: <subcommand> [args...]
allowed-tools: Bash(grove ws add *), Bash(grove ws list *), Bash(grove ws remove *), Bash(grove ws status *), Bash(grove ws path *), Bash(grove ws sync *)
---

Run the grove workspace subcommand with the provided arguments:

```
grove ws $ARGUMENTS
```

## Subcommands

- `add <name>` — create a new workspace
- `list` — list all workspaces
- `remove <name> [--force]` — remove a workspace
- `status [workspace]` — show repos and worktrees overview
- `path [workspace]` — print workspace filesystem path
- `sync [workspace]` — repair workspace symlinks to match workspace.json

All subcommands accept `--text` (default), `--porcelain` (tab-separated for scripts), or `--json` (`{"ok","data"}` envelope for programmatic consumers). Errors include `error:` and `code:` lines.

Run the command and report the result. If it fails, show the error message and error code.

## Notes

- Reserved names: `repos` and `worktrees` cannot be used as workspace names
- Workspace names may not contain `/`, `\`, or `..`
- Current workspace is inferred by walking up from `$PWD` looking for `workspace.json`
- `sync` is idempotent — safe to run repeatedly to repair symlinks
