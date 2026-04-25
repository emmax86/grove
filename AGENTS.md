# AGENTS.md

This file provides guidance to Codex and other agentic coding tools when working
with code in this repository.

## Commands

```bash
bun test                          # run all tests
bun test src/__tests__/foo.test.ts  # run a single test file
bun run build                     # compile to bin/grove binary
bun run format                    # format and lint with biome
bun run format:check              # check formatting and lint with biome
```

## Architecture

`grove` is a CLI tool (compiled via `bun build --compile`) that manages named
**workspaces**, each containing **repos** and **worktrees**.

### Data model

- **Workspace** — a named directory under `GROVE_ROOT` (default:
  `~/grove-workspaces`). Contains a `workspace.json` config, a `.claude/`
  directory, and generated workspace entry files such as `CLAUDE.md` and
  `AGENTS.md`.
- **Repo** — a git repository registered in a workspace. Stored as a symlink at
  `repos/{name} -> <absolute-path>`. A workspace-local tree entry is also
  created at `{workspace}/trees/{name} -> ../../repos/{name}`.
- **Worktree** — a git worktree tracked under `{workspace}/trees/{repo}/{slug}/`.
  Three kinds:
  - `pool` — symlink into the shared pool at `worktrees/{repo}/{slug}`. Multiple
    workspaces can share the same pool entry. Tracked in `worktrees.json`.
  - `linked` — symlink to `repos/{repo}` (the default-branch entry created
    automatically when a repo is added).
  - `legacy` — real directory (old-style, pre-pool).

The `classifyWorktreeEntry()` function in `src/lib/worktree-utils.ts`
distinguishes these by reading the symlink target prefix.

### Result pattern

All functions return `Result<T>` (`{ ok: true; value: T } | { ok: false; error:
string; code: string }`). Error codes are SCREAMING_SNAKE_CASE strings. The
CLI's `output()` helper writes JSON to stdout/stderr and exits 1 on error.

### Context inference

`inferContext(cwd, root)` in `src/context.ts` walks up from the current
directory looking for `workspace.json` to determine the active workspace, repo,
and worktree. This enables most commands to infer arguments from the working
directory. It uses `realpathSync` to handle macOS `/tmp -> /private/tmp`
aliasing.

### Paths

All filesystem paths are centralized through the `Paths` object created by
`createPaths(root)` in `src/constants.ts`. Never hardcode paths.

### CLI and integrations

`src/cli.ts` handles flat arg parsing (no external parser). The top-level
command is `grove ws <subcommand>` (also aliased as `grove workspaces`). All
output goes through `render(result, kind, ctx)` in `src/lib/render/`.

The Grove CLI is the source of truth. Agent integrations should prefer calling
`grove ws ...` directly. The Claude plugin, Codex plugin, and MCP server are
adapters around the CLI rather than alternative implementations.

### Output rendering

All CLI output goes through `render(result, kind, ctx)` in `src/lib/render/`. Three mutually-exclusive modes:

- **default text** — human/agent-readable, with ANSI colors when `process.stdout.isTTY && !NO_COLOR && !--no-color`.
- **`--porcelain`** — tab-separated, denormalized for nested data, no headers, no colors.
- **`--json`** — `{"ok", "data"}` envelope unchanged from the original implementation.

Adding a command requires registering text + porcelain formatters in `src/lib/render/formatters/` and adding the new kind to the `CommandKind` union (TypeScript exhaustiveness check enforces both modes are wired). JSON is automatic from the `Result<T>` value.

Output invariants enforced by tests in `src/__tests__/lib/render/invariants.test.ts`:
- No information conveyed by color, font weight, or Unicode symbols alone.
- Default palette is red / cyan / yellow / dim / bold (never red / green).
- `stripAnsi(text(value, color=true)) === text(value, color=false)` for every formatter.
- ASCII fallback exists for tree chars and arrows under `LANG=C` / `--ascii`.
- `--porcelain` is tab-separated, denormalized, no headers, no color.

## Tests

Tests live in `src/__tests__/` with subdirectories `commands/`, `e2e/`,
`integration/`, and `lib/`.

The shared test helpers in `src/__tests__/helpers.ts` provide:

- `createTestDir()` — creates a temp dir with `realpathSync` applied
- `createTestGitRepo()` — sets up a real git repo with an initial commit
- `GIT_ENV` — env vars to pass to git to bypass system config and GPG signing

All git operations in tests pass `GIT_CONFIG_NOSYSTEM=1` to avoid triggering
GPG signing.

## Change discipline

- Follow the existing `Result<T>` error-handling pattern.
- Use `Paths` helpers instead of hardcoded filesystem paths.
- Prefer extending the existing generators and command flows instead of adding
  parallel code paths for different agents.
- Do not overwrite user-owned workspace entry files like `CLAUDE.md` or
  `AGENTS.md` if they already exist.
