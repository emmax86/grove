# Context Loading Contract

`grove ws context` has two modes:

- `grove ws context <workspace>` returns a lazy workspace index.
- `grove ws context <workspace> <target>` loads instruction content for one
  resolved workspace target.

The command is intended for agents. Keep output deterministic, reload commands
portable across current working directories, and instruction selection
conservative when a higher-priority file is present but unreadable.

## Target Resolution

Targets are workspace-relative paths such as `trees/api/main` or
`trees/api/main/packages/auth`. Target mode resolves a path to one worktree,
then loads instruction files from the worktree root to the target directory.

Reload commands must include the workspace name and the resolved loaded scope:

```text
grove ws context myws trees/api/main/packages/auth
```

They must not rely on `.` or on the caller's current working directory.

`trees/<repo>` is ambiguous because it names a repo container, not one worktree.
Return `CONTEXT_TARGET_AMBIGUOUS` and list available worktree slugs instead of
choosing one.

## Workspace Disambiguation

When parsing `grove ws context <arg>`, treat `<arg>` as a workspace if it names
an existing workspace or a workspace whose config exists but is invalid. Invalid
workspace config must surface as `CONFIG_INVALID`; do not reinterpret the token
as a target.

Only `WORKSPACE_NOT_FOUND` allows the token to be considered a target for the
inferred current workspace.

## Instruction Priority

Each directory can contribute at most one instruction file. Candidate files are
checked in this order:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. `CLAUDE.md`

A definitely absent candidate falls through to the next candidate.

An existing but unreadable candidate, including a dangling symlink, is recorded
in `skipped` and blocks lower-priority files in the same directory. This is
fail-closed behavior: do not silently substitute `AGENTS.md` when an
`AGENTS.override.md` is present but cannot be read.

Readable symlinked instruction files are valid instruction files and keep their
workspace-relative source path in output.

## Directory Traversal

Workspace indexing recurses through real directories under workspace worktrees.
It skips `.git` and `node_modules`.

Workspace indexing does not recurse into symlinked directories. Record the
symlinked directory in `skipped` with a visible reason. This prevents a workspace
index from following directory symlinks outside the worktree.

Target mode loads only ancestor directories between the resolved worktree root
and target directory; it does not perform a recursive scan.

## Porcelain Schema

Porcelain output is tab-separated, has no headers, and uses row-type-specific
schemas.

Workspace index rows:

```text
index <workspace> <repo> <slug> <scope> <source-path> <kind> <hash> <context-key>
```

Target metadata rows:

```text
target <workspace> <repo> <slug> <scope> <worktree-path> <context-key> <context-hash>
```

Loaded source rows:

```text
source <workspace> <repo> <slug> <scope> <source-path> <kind> <hash> <context-key>
```

`scope` omits the leading `trees/` prefix and is used consistently in column 5
for `index`, `target`, and `source` rows. Text and JSON target output still keep
`loadedScope` with the leading `trees/` prefix because it is directly reusable
as a stable reload target.
