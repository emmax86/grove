---
description: Manage repos registered in a grove workspace (add, list, remove)
argument-hint: <subcommand> [workspace] [args...]
allowed-tools: Bash(grove ws repo add *), Bash(grove ws repo list *), Bash(grove ws repo remove *)
---

Run the grove repo subcommand with the provided arguments:

```
grove ws repo $ARGUMENTS
```

## Subcommands

- `add [workspace] <path> [--name <name>]` — register a git repo in a workspace
- `list [workspace]` — list repos in a workspace
- `remove [workspace] <name> [--force]` — unregister a repo

The `workspace` argument is inferred from `$PWD` when omitted.

All subcommands accept `--text` (default), `--porcelain` (tab-separated for scripts), or `--json` (`{"ok","data"}` envelope for programmatic consumers). Errors include `error:` and `code:` lines.

Run the command and report the result. If it fails, show the error message and error code.

## Notes

- Reserved name: `trees` cannot be used as a repo name
- Repo names may not contain `/`, `\`, or `..`
- `remove` preserves the global `repos/{name}` symlink — other workspaces may still reference it
- Multiple workspaces can register the same repo; they share the global symlink
