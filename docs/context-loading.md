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

Workspace indexing enumerates instruction files git-natively: it runs
`git ls-files --cached --others --exclude-standard` at the worktree root and
filters the result to the three instruction filenames (`AGENTS.override.md`,
`AGENTS.md`, `CLAUDE.md`). `.gitignore` governs entirely on this path — there is
no hardcoded ignore list. Vendored or generated directories (`.venv`,
`node_modules`, `target/`, and so on) are excluded automatically because git
already excludes them, with zero grove-side configuration.

When git enumeration fails — the worktree directory is not a git repo, or git
itself errors — indexing falls back to a recursive directory walk. The walk has
no `.gitignore` awareness of its own, so it hardcodes a small skip set
(`.git`, `.worktrees`, `node_modules`) and does not recurse into symlinked
directories; a skipped symlinked directory is recorded in `skipped` with a
visible reason. This fallback-only hardcoding prevents the walk from following
directory symlinks outside the worktree or descending into version-control
internals when there is no `.gitignore` to consult.

Target mode loads only ancestor directories between the resolved worktree root
and target directory; it does not perform a recursive scan, so neither the
git-native enumeration nor the walk fallback applies there — it checks each
ancestor directory directly for the three instruction filenames.

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

## Touch Protocol

`grove ws context touch <paths>` and the `context_touch` MCP tool serve
not-yet-seen instruction content for the paths an agent is about to work on.
Call it before reading or editing files in a part of the tree you haven't
touched yet this session.

For each path, touch resolves the same scope chain as target loading:
workspace instructions (`.grove/instructions.md`, when present) first, then
worktree instruction sources from the worktree root down to the path's own
directory (a file path resolves to its parent directory). Multiple paths in one
call are resolved independently and then batch-deduplicated — each unique scope
is classified and journaled at most once per call, even when two paths share
ancestors.

Each resolved scope classifies against the caller's session state as one of
four statuses:

- `served` — first time this session has seen this scope; full content is
  returned.
- `current` — already served, content unchanged since; a one-line marker only,
  no content.
- `updated` — already served, content hash changed since (the file was
  edited); full content is returned.
- `refreshed` — already served, `--refresh` passed; full content is returned
  regardless of hash.

Touch is idempotent and cheap to over-call. Touching the same paths repeatedly
returns `current` markers once content has been served, so agents should call
it liberally on every new path rather than trying to reason about whether a
scope "needs" touching.

If a touched path resolves inside a gitignored directory (for example
something under `node_modules`), the scope chain is truncated at the deepest
non-ignored ancestor directory before it is walked. Gitignored ancestors are
never checked for instruction files, so vendored instruction files never serve.

`--refresh` bypasses the "already current" short circuit for scopes already
served this session, forcing a full re-send of their content; it does not
clear or reset the session's served-state, and scopes never served this
session still classify as `served` even with `--refresh` passed.

Use `grove ws context sessions` to inspect active disclosure sessions and the
scopes each has served (daemon only — see Session Ledgers below).

## Session Ledgers

Served-state per session is tracked by a `ContextLedger`: an in-memory
`Map<contextKey, contentHash>` recording what content each session has already
been sent. The ledger is the sole AUTHORITY for touch's `served`/`current`/
`updated`/`refreshed` decisions.

Ledgers are held by the workspace daemon and are deliberately not persisted to
disk:

- MCP sessions get one ledger per MCP transport session, keyed by the session
  id the MCP SDK assigns on connect.
- CLI callers get one ledger per `--session <key>` string, held in a
  daemon-side map keyed by that literal string. Reusing the same `--session`
  key across CLI invocations reuses the same served-state. Note that a daemon
  with no active MCP session shuts down after its grace period, after which a
  CLI `--session` key's served-state resets and its content re-serves (the safe
  direction) — so CLI `--session` dedup only persists while the daemon is kept
  alive.

A fresh ledger always starts empty, so every scope it is asked about starts at
`served`. This happens on MCP session reconnect, on daemon restart, and the
first time a given `--session` key is used. Re-serving already-seen content is
the safe failure direction — a session that thinks it has seen something it
was never actually sent is the failure mode to avoid, not the reverse.

If no daemon is running (or the daemon is unreachable), CLI touch calls fall
back to a stateless local touch with no ledger at all: every scope always
classifies as `served`, and any `--session` key passed is silently ignored.
This fallback is never worse than not having disclosure at all — content
simply isn't deduplicated across calls.

## Disclosure Journal & Blob Store

Every touch decision is recorded to an append-only, write-through observation
store rooted at `.grove/state/context/` inside the workspace:

- `.grove/state/context/journal.jsonl` — one JSON object per line, one line
  per classified scope:

  ```json
  {"ts":"2026-07-01T12:00:00.000Z","session":"mcp-session-id","trigger":"mcp","contextKey":"myws/api/main","contentHash":"<sha256>","action":"served"}
  ```

  `trigger` is `"mcp"` or `"cli"` depending on which surface issued the touch.
  `action` is the same `served`/`current`/`updated`/`refreshed` status served
  to the caller.
- `.grove/state/context/objects/<hash>` — content-addressed blobs, one file per
  distinct content hash, written once (write-once: an object that already
  exists on disk is never rewritten).

The journal and blob store are **observation-only**: nothing on the serving
path ever reads them. Touch decisions are made entirely from the in-memory
session ledger described above. Deleting the journal, corrupting a line, or
wiping the objects directory changes no serving behavior — it only destroys the
observability record. Every write goes through a try/catch that swallows I/O
errors for the same reason: a broken state directory must never break
disclosure.

The state directory self-ignores (`.grove/state/context/.gitignore` containing
`*`, written on first use) so machine state never touches the user's root
`.gitignore` or appears in `git status`.

The journal rotates when it exceeds a size threshold (default 5 MiB): the
active `journal.jsonl` is renamed into a numbered archive segment
(`journal.1.jsonl`, `journal.2.jsonl`, ...) and a fresh `journal.jsonl` is
started. Retention is a bounded N-segment ring (default 2 segments total,
active + one archive) — rotating past the ring evicts the oldest segment, and
any blob no longer referenced by a retained segment is pruned from the objects
directory.

## Registration

Grove registers itself as an MCP server for a workspace by writing a workspace
root `.mcp.json` (generated alongside the root `AGENTS.md`/`CLAUDE.md`
bootstrap shims, and equally not overwritten if it already exists):

```json
{
  "mcpServers": {
    "grove": {
      "command": "grove",
      "args": ["mcp", "connect"]
    }
  }
}
```

`grove mcp connect` is the stdio bridge a harness actually launches per editor
session: it pumps JSON-RPC messages between the harness's stdio transport and
the workspace daemon's streamable-HTTP `/mcp` endpoint. Before bridging, it
calls the same daemon-discovery logic touch uses; if no daemon is discoverable
for the workspace it auto-starts one as a detached background process
(`grove mcp serve` under the hood) and polls until the daemon's discovery file
appears. Multiple `connect` invocations — e.g. several editor sessions against
the same workspace — all bridge to the same singleton daemon, so ledgers are
shared per session as described above, not per bridge process.

## Porcelain Schema

Porcelain output is tab-separated, has no headers, and uses row-type-specific
schemas. Consumers must branch on the first column (`target`, `source`,
`index`, or `touch`); target metadata rows have 8 columns, source and index
instruction rows have 13 columns, and touch rows have 6 columns.

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

Touch rows:

```text
touch <workspace> <contextKey> <status> <contentHash> <sourcePath>
```

One row per classified scope in the touch call. `status` is one of
`served`/`current`/`updated`/`refreshed`. Unlike source rows, touch rows carry
no `content` column — content, when present, is only available in text or JSON
output.

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

## Conventions

Prefer `AGENTS.md` over `CLAUDE.md` for nested-scope instruction files in grove
workspaces. Instruction priority already resolves `AGENTS.md` ahead of
`CLAUDE.md` (see Instruction Priority above), but the choice of which file to
author matters beyond ordering: Claude Code natively auto-loads nested
`CLAUDE.md` files when it reads a file in that directory, independent of
grove's own context disclosure. Authoring nested scopes as `CLAUDE.md` means
Claude Code sessions receive that content twice — once from its own built-in
nested-file loading, once from `grove ws context touch` — while other
harnesses that only understand `AGENTS.md` never see it natively at all.
Authoring as `AGENTS.md` avoids the double-serving on Claude Code and keeps
disclosure the single source of truth for nested instruction content across
harnesses.
