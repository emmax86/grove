# Context Loading Contract

`grove ws context` has two modes:

- `grove ws context` or `grove ws context <workspace>` returns a lazy
  workspace index for the inferred or named workspace.
- `grove ws context <target>` or `grove ws context <workspace> <target>` loads
  instruction content for one resolved workspace target.

The command is intended for agents. Keep output deterministic, reload commands
portable across current working directories, and instruction selection
conservative when a higher-priority file is present but unreadable.

## Workspace Instructions

Workspace-owned instructions live at `.grove/instructions.md`. When present,
they are loaded before worktree instructions and exposed as a normal instruction
source with:

- `path` and `sourcePath`: `.grove/instructions.md`
- `kind`: `workspace`
- `layer`: `workspace`
- `ownership`: `user`
- `selectionReason`: `workspace instruction file`

Workspace text output includes a `## Workspace Instructions` section containing
this source and its content. Workspace porcelain output includes it as a
`source` row with empty repo and slug columns and `scope` set to `workspace`.

## Target Resolution

Targets are workspace-relative paths such as `trees/api/main` or
`trees/api/main/packages/auth`. Target mode resolves a path to one worktree,
then loads instruction files from the worktree root to the target directory.
Target `sources` are ordered as workspace instructions first, when present,
followed by worktree instruction sources from the resolved worktree root down to
the target directory.

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

Each worktree directory can contribute at most one instruction file. Candidate
files are checked in this order:

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

## Graph And Provenance

Every context response includes a deterministic `graph`:

- `graph.root` is the effective context root hash.
- Workspace responses include `graph` and, when present,
  `workspaceInstructions`.
- Target responses include `graph`; `contextHash` is exactly `graph.root`.

Every `ContextIndexEntry` and `ContextInstructionSource` includes provenance:

- `layer`: `workspace` or `target`
- `ownership`: `user` or `generated`
- `selectionReason`: why the source was selected
- `contentHash`: SHA-256 hash of the source content
- `hash`: compatibility alias for `contentHash`

Text source sections show layer, ownership, selection reason, source/content
hash, and context key. JSON output exposes the full graph and provenance fields.
`graph.root`/`contextHash` is the compact identity for the effective context as a
whole; individual sources expose `contentHash` rather than per-node hashes.

## Porcelain Schema

Porcelain output is tab-separated, has no headers, and uses row-type-specific
schemas. Consumers must branch on the first column (`target`, `source`, or
`index`); target metadata rows have 8 columns, while source and index
instruction rows have 13 columns.

Workspace instruction source rows:

```text
source <workspace> <empty-repo> <empty-slug> workspace .grove/instructions.md workspace <hash> <context-key> workspace user <selection-reason> <content-hash>
```

Workspace index rows:

```text
index <workspace> <repo> <slug> <scope> <source-path> <kind> <hash> <context-key> <layer> <ownership> <selection-reason> <content-hash>
```

Target metadata rows:

```text
target <workspace> <repo> <slug> <scope> <worktree-path> <context-key> <context-hash>
```

Loaded source rows:

```text
source <workspace> <repo> <slug> <scope> <source-path> <kind> <hash> <context-key> <layer> <ownership> <selection-reason> <content-hash>
```

`scope` omits the leading `trees/` prefix and is used consistently in column 5
for `index`, `target`, and `source` rows. Text and JSON target output still keep
`loadedScope` with the leading `trees/` prefix because it is directly reusable
as a stable reload target.

For instruction rows, the first nine columns match the original source/index
schema. Provenance columns are appended so consumers that key on the prefix can
continue to do so while newer consumers can read the graph metadata.

## Workspace Root Bootstrap Files

Grove creates root `AGENTS.md` and `CLAUDE.md` files when a workspace is created
or agent files are regenerated and those files do not already exist. The
generated files are bootstrap shims: they tell agents to run
`grove ws context`, then `grove ws context <target>`, and to treat that output
as canonical.

Existing root `AGENTS.md` and `CLAUDE.md` files are user-owned and are not
overwritten. These root files are not the canonical workspace instruction
source; use `.grove/instructions.md` for workspace-wide instructions that should
participate in context loading, provenance, and graph hashing.
