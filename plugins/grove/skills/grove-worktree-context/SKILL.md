---
name: grove-worktree-context
description: Orient yourself inside a grove workspace and load instruction context before working on files. Discovers the active workspace, registered repos, and available worktrees, then serves scoped instruction content for the paths you're about to touch. Use at the start of any task when working in a grove-managed workspace, and again before editing files in a part of the tree you haven't touched yet this session.
allowed-tools: Bash(grove ws context *), Bash(grove ws status *), Bash(grove ws worktree list *), Bash(grove ws sync *)
---

## Orient

Run the following to get workspace context:

```
grove ws context
```

This returns a lazy index for the current (or named) workspace: the workspace
name and path, registered repos, their worktrees, and an index of every
instruction file grove has found across them (path, scope, content hash). It
does not load full instruction content — use touch for that (see below).

If `grove` is not in PATH, the binary is at `bin/grove` within the grove repo
worktree, or at `{workspace}/trees/{grove-repo}/{default-branch}/bin/grove`
from the workspace root (derive `{grove-repo}` and `{default-branch}` from the
`grove ws context` or `grove ws status` output).

`grove ws status` returns the same repo/worktree topology in a plainer shape
(`type: "linked"` for a repo's default-branch worktree, `type: "worktree"` for
a pooled or legacy worktree, `status: "dangling"` for a repo whose symlink is
broken — run `grove ws sync` to repair it).

## Touch before working on files

Before reading or editing files in a part of the tree you haven't touched yet
this session, run:

```
grove ws context touch <paths>
```

passing the file or directory paths you're about to work on. This serves the
instruction content (workspace instructions plus every ancestor
`AGENTS.md`/`CLAUDE.md` down to each path) that you haven't already seen this
session. Already-served, unchanged scopes come back as a one-line marker
instead of full content — the call is cheap, so touch every path you're about
to work on rather than trying to guess whether it's already covered.

When connected to grove over MCP, prefer the `context_touch` tool over
shelling out to the CLI — same behavior, no subprocess.

**Touch is idempotent and safe to over-call.** If a file's instructions change
mid-session (edited on disk), the next touch of that path re-serves the
updated content automatically — you don't need to detect the change yourself
or ask for a reload.

## Finding a worktree path

Worktrees are accessible via the workspace symlink tree:

```
{workspace}/trees/{repo}/{slug}/
```

Use this path to navigate to or reference a specific worktree. Run
`grove ws worktree list [repo]` to see all worktrees for a specific repo with
their slugs and branches.

If any command fails, report the error message and error code.
