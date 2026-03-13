---
name: grove-worktree-context
description: Orient yourself inside a grove workspace. Discovers the active workspace, registered repos (each with its source path), and all available worktrees with their branches and path template ({workspace}/trees/{repo}/{slug}/). Use at the start of any task when working in a grove-managed workspace, or when you need to know which worktree to work in.
allowed-tools: Bash(grove ws status *), Bash(grove ws worktree list *), Bash(grove ws sync *)
---

Run the following to get full workspace context:

```
grove ws status
```

This returns the workspace name, path, all registered repos (each with `name`, `path`, `status`), and their worktrees (`repo`, `slug`, `branch`, `type`). The path to each worktree is derived as `{workspace}/trees/{repo}/{slug}/`.

If `grove` is not in PATH, the binary is at `.bin/grove` within the grove repo worktree, or at `{workspace}/trees/{grove-repo}/{default-branch}/.bin/grove` from the workspace root (derive `{grove-repo}` and `{default-branch}` from the `grove ws status` output).

## Interpreting the output

- `type: "linked"` — the default-branch entry for a repo (created automatically when the repo was registered)
- `type: "worktree"` — a pooled or legacy git worktree (use `{workspace}/trees/{repo}/{slug}/` to find its path)
- a repo with `status: "dangling"` — the repo symlink is broken; run `grove ws sync` to repair if the source path still exists, otherwise the repo registration itself must be fixed

## Finding a worktree path

Worktrees are accessible via the workspace symlink tree:

```
{workspace}/trees/{repo}/{slug}/
```

Use this path to navigate to or reference a specific worktree. Run `grove ws worktree list [repo]` to see all worktrees for a specific repo with their slugs and branches.

If any command fails, report the error message and error code.
