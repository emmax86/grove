---
name: create-grove-worktree
description: Create a new git worktree in a grove workspace using the grove CLI. Use when asked to start work on a new branch, create a worktree, or work in isolation from other branches.
allowed-tools: Bash(grove ws worktree add:*), Bash(grove ws worktree list:*)
---

Create a worktree using the grove CLI (not `git worktree add` directly):

```
grove ws worktree add [repo] <branch> [--new] [--from <base>]
```

## When to use each flag

- Existing branch: `grove ws worktree add myrepo existing-branch`
- New branch off current HEAD: `grove ws worktree add myrepo feature/name --new`
- New branch off a specific base: `grove ws worktree add myrepo feature/name --new --from origin/main`

## After creation

The worktree is placed in the shared pool and symlinked into the workspace tree:

```
{workspace}/trees/{repo}/{slug}/
```

The slug is the branch name with `/` replaced by `-` (e.g. `feature/name` → `feature-name`).

Navigate to this path to begin work. Do not use `cd` into the pool path directly — always use the `trees/` symlink.

## Notes

- Do not use `git worktree add` directly; grove manages the pool and workspace symlinks
- The `repo` argument is inferred from `$PWD` when running inside a workspace repo directory
- Run `grove ws worktree list [repo]` to confirm the worktree was created
