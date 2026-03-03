# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun test                          # run all tests
bun test src/__tests__/foo.test.ts  # run a single test file
bun run build                     # compile to .bin/grove binary
bun run format                    # format and lint with biome
bun run format:check              # check formatting and lint with biome
```

## Architecture

`grove` is a CLI tool (compiled via `bun build --compile`) that manages named **workspaces**, each containing **repos** and **worktrees**.

### Data model

- **Workspace** — a named directory under `GROVE_ROOT` (default: `~/grove-workspaces`). Contains a `workspace.json` config, a `.claude/` directory, and subdirectories per repo.
- **Repo** — a git repository registered in a workspace. Stored as a symlink at `repos/{name} → <absolute-path>`. A workspace-local tree entry is also created at `{workspace}/trees/{name} → ../../repos/{name}`.
- **Worktree** — a git worktree tracked under `{workspace}/trees/{repo}/{slug}/`. Three kinds:
  - `pool` — symlink into the shared pool at `worktrees/{repo}/{slug}`. Multiple workspaces can share the same pool entry. Tracked in `worktrees.json`.
  - `linked` — symlink to `repos/{repo}` (the default-branch entry created automatically when a repo is added).
  - `legacy` — real directory (old-style, pre-pool).

The `classifyWorktreeEntry()` function in `src/lib/worktree-utils.ts` distinguishes these by reading the symlink target prefix.

### Result pattern

All functions return `Result<T>` (`{ ok: true; value: T } | { ok: false; error: string; code: string }`). Error codes are SCREAMING_SNAKE_CASE strings. The CLI's `output()` helper writes JSON to stdout/stderr and exits 1 on error.

### Context inference

`inferContext(cwd, root)` in `src/context.ts` walks up from the current directory looking for `workspace.json` to determine the active workspace, repo, and worktree. This enables most commands to infer arguments from the working directory. It uses `realpathSync` to handle macOS `/tmp → /private/tmp` aliasing.

### Paths

All filesystem paths are centralised through the `Paths` object created by `createPaths(root)` in `src/constants.ts`. Never hardcode paths — always go through `Paths`.

### CLI

`src/cli.ts` handles flat arg parsing (no external parser). The top-level command is `grove ws <subcommand>` (also aliased as `grove workspaces`). `--porcelain` switches output from JSON to tab-separated plaintext.

Subcommands: `add`, `list`, `remove`, `repo`, `worktree`, `status`, `path`, `sync`.

`ws sync [workspace]` — idempotent repair command. Reads `workspace.json` and recreates any missing or dangling `repos/<name>` symlinks, `trees/<repo>/` directories, and default-branch symlinks. Also prunes dangling pool worktree symlinks. Returns per-repo `status` of `ok`, `repaired`, or `dangling` (source path no longer a git repo).

### Plugin

`.claude-plugin/` contains a `plugin.json` manifest and `commands/*.md` slash-command definitions for use as a Claude Code plugin.

## Tests

Tests live in `src/__tests__/` with subdirectories `commands/`, `e2e/`, `integration/`, and `lib/`.

The shared test helpers in `src/__tests__/helpers.ts` provide:

- `createTestDir()` — creates a temp dir with `realpathSync` applied (required for macOS symlink resolution)
- `createTestGitRepo()` — sets up a real git repo with an initial commit
- `GIT_ENV` — env vars to pass to git to bypass system config and GPG signing

All git operations in tests pass `GIT_CONFIG_NOSYSTEM=1` to avoid triggering GPG signing.

## TDD process

When implementing features, follow strict test-driven development:

1. **Red**: Write tests for the current behavior unit. Tests must fail. Run `bun test` to confirm the new tests fail.
2. **Green**: Implement the minimum code to make those tests pass. Run `bun test` after each change.
3. **Refactor**: Clean up while keeping tests green.
4. Repeat for the next behavior unit.

### Micro-cycles

For multi-behavior features, use one Red-Green-Refactor cycle per distinct behavior (e.g., return type change, then hashing, then scanning). Never implement behavior in a Green phase that has no corresponding failing test in the preceding Red phase.

### Rules

- Never write implementation before a failing test exists for the behavior.
- Test the `Result<T>` return value, not side effects alone — check both `result.ok` and the value/error.
- Use `createTestGitRepo()` and real filesystem state, not mocks.
- Error codes are SCREAMING_SNAKE_CASE. Add new codes to the error catalog in this file.
- One test = one behavior. Name tests as "does X when Y" or "returns ERROR_CODE when Y".

## Commits

Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) — enforced by commitlint.
