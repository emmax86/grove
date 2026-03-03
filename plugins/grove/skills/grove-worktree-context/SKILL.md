---
name: grove-worktree-context
description: Orient yourself inside a grove workspace. Discovers the active workspace, registered repos, and all available worktrees with their branches and paths. Use at the start of any task when working in a grove-managed workspace, or when you need to know which worktree to work in.
allowed-tools: Bash(grove ws status:*) Bash(grove ws worktree list:*)
---

Run the following to get full workspace context:

```
grove ws status
```

This returns the workspace name, path, all registered repos, and their worktrees (slug, branch, type, path).

If `grove` is not in PATH, the binary is typically at `trees/grove/main/.bin/grove` relative to the workspace root, or at `.bin/grove` within the grove repo worktree.

## Interpreting the output

- `type: "linked"` — the default-branch entry for a repo (created automatically when the repo was registered)
- `type: "worktree"` — a git worktree in the shared pool at `worktrees/{repo}/{slug}/`
- `status: "dangling"` — the repo symlink is broken; run `grove ws sync` to repair

## Finding a worktree path

Worktrees are accessible via the workspace symlink tree:

```
{workspace}/trees/{repo}/{slug}/
```

Use this path to navigate to or reference a specific worktree.
