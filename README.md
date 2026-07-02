# grove

CLI tool for managing named workspaces that group git repos and worktrees,
with auto-generated Claude Code and VS Code configuration.

- Named workspaces under `~/grove-workspaces/` (configurable via `GROVE_ROOT`)
- Register git repos, manage git worktrees in a shared pool across workspaces
- Auto-generates `CLAUDE.md`, `.claude/trees.md`, and `{workspace}.code-workspace` VS Code workspace files
- Context inference — most commands detect workspace/repo from CWD

## Directory layout

```
~/grove-workspaces/
  repos/
    my-api -> /path/to/my-api              # global repo symlinks
  worktrees/
    my-api/
      feat-auth/                            # shared git worktree
  myproject/
    workspace.json
    CLAUDE.md                               # auto-generated
    .claude/trees.md                        # auto-generated @-references
    myproject.code-workspace                # auto-generated
    trees/
      my-api/
        main -> ../../../repos/my-api                     # linked (default branch)
        feat-auth -> ../../../worktrees/my-api/feat-auth  # pool
```

## Quick start

**Prerequisite**: [Bun](https://bun.sh)

```bash
git clone <repo-url> && cd grove
bun install && bun run build && bun link

grove ws add myproject
grove ws repo add myproject ~/code/my-api
grove ws repo add myproject ~/code/web-client

cd ~/grove-workspaces/myproject   # worktree commands infer workspace from CWD
grove ws worktree add my-api feat-auth --new
grove ws status
```

> **Note**: `worktree add` infers the workspace from CWD — run it from inside the
> workspace directory, or pass `--workspace myproject` explicitly.

`grove ws status` shows a tree by default:

```
myproject (~/grove-workspaces/myproject)
├── my-api (/path/to/my-api) [ok]
│   ├── main (linked)
│   └── feat-auth (worktree, branch: feat-auth)
└── web-client (/path/to/web-client) [ok]
```

Pipe to `--json` for programmatic use:

```bash
grove ws status --json | jq '.data.repos[] | select(.status=="dangling") | .name'
```

## Commands

### Workspaces — `grove ws <command>`

| Command                          | Description                                |
| -------------------------------- | ------------------------------------------ |
| `add <name>`                     | Create a workspace                         |
| `list`                           | List workspaces                            |
| `remove [name] [--force]`        | Remove a workspace                         |
| `status [workspace]`             | Repos + worktrees overview                 |
| `context <subcommand>`           | Agent instruction context (see below)      |
| `path [workspace]`               | Print workspace path                       |
| `sync [workspace]`               | Repair symlinks, prune dangling entries    |
| `exec <command> [file]`          | Run standard commands against a repo       |

See [docs/context-loading.md](docs/context-loading.md) for the `context`
loading contract, instruction priority, and porcelain row schemas.

### Context — `grove ws context <command>`

| Command                                                | Description                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------|
| `show [workspace] [target]`                             | Show workspace context or load a target scope (default; `grove ws context [workspace] [target]` also routes here) |
| `touch <paths...> [--session K] [--refresh]`            | Serve not-yet-seen instruction scopes for paths you're about to work on |
| `sessions`                                              | List active disclosure sessions and their served scopes (daemon) |

### Repos — `grove ws repo <command>`

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| `add [workspace] <path> [--name N]`   | Register a git repo   |
| `list [workspace]`                    | List registered repos |
| `remove [workspace] <name> [--force]` | Unregister a repo     |

### Worktrees — `grove ws worktree <command>`

| Command                                                  | Description                     |
| -------------------------------------------------------- | ------------------------------- |
| `add [repo] <branch> [--new] [--from base] [--no-setup]` | Create a worktree (shared pool) |
| `list [repo]`                                            | List worktrees                  |
| `remove [repo] <slug> [--force]`                         | Remove a worktree               |
| `prune`                                                  | Clean up dangling symlinks      |

### Exec — `grove ws exec <command>`

Run standard commands against a repo without needing to know its toolchain:

| Command                                 | Description                  |
| --------------------------------------- | ---------------------------- |
| `setup`                                 | Install dependencies         |
| `format`                                | Format and lint code         |
| `test`                                  | Run the full test suite      |
| `test:file <file>`                      | Run tests for a single file  |
| `test:match [file] [--match <pattern>]` | Run tests matching a pattern |
| `check`                                 | Typecheck the project        |

`setup`, `format`, and `test` are auto-detected from lockfiles (`bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `uv.lock` → uv). `test:file`, `test:match`, and `check` require a per-repo `.grove/commands.json` entry.

Options: `--repo <name>` (required when no file is given, otherwise inferred from file path), `--match <pattern>` (filter pattern for `test:match`), `--dry-run` (print resolved command without running).

### MCP — `grove mcp <command>`

| Command                        | Description                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| `serve [--workspace W] [--port P]` | Run the MCP daemon for a workspace (alias: `grove mcp-server`)   |
| `connect [--workspace W]`      | stdio bridge to the workspace daemon (auto-starts it); for `.mcp.json` |

### Other

| Command                                 | Description                                  |
| --------------------------------------- | -------------------------------------------- |
| `mcp-server [--workspace W] [--port P]` | Start MCP server (top-level, not under `ws`) |

Bracketed args are inferred from CWD. Override with `--workspace` flag or `GROVE_WORKSPACE` env var.

## Output modes

Every command supports three output modes:

- **default** — human/agent-readable text. Tree for `status`, aligned columns for lists, single-line confirmations for mutations, multi-line `error:` / `code:` for failures. Honors `NO_COLOR=1`, `--no-color`, and disables ANSI codes when stdout is not a TTY.
- **`--porcelain`** — stable tab-separated form for shell scripts (`awk`, `cut`). One row per result; nested data flattens with parent fields repeated.
- **`--json`** — `{"ok": true, "data": <T>}` envelope (`{"ok": false, ...}` on error). Pretty-printed in a TTY, single-line otherwise. Suitable for `jq` pipelines.

`--porcelain` and `--json` together is an error.

Output captured to a file or piped to another command is byte-identical to terminal output minus ANSI escape codes.

## Integrations

- **Claude Code plugin** — `.claude-plugin/marketplace.json` is the Claude marketplace file, and `plugins/grove/commands/` contains the `/workspace`, `/workspace-status`, `/worktree`, `/repo`, `/exec` slash command implementations
- **Codex plugin** — `.agents/plugins/marketplace.json` exposes `plugins/grove/` as a Codex plugin; `plugins/grove/.codex-plugin/plugin.json` is the manifest, `plugins/grove/skills/` contains Codex skills, and `plugins/grove/hooks/hooks.json` is the default bundled hook config
- **MCP server** — `grove mcp-server` exposes workspace operations over MCP for AI tool integration
- **Auto-generated files** — adding/removing repos creates `CLAUDE.md` once (if absent), then regenerates `.claude/trees.md` and `{workspace}.code-workspace` to keep editor and agent configs in sync

### Codex

The Codex integration is intentionally CLI-first. The plugin in `plugins/grove/`
packages Grove's existing skills and a bundled lifecycle hook so Codex uses:

- `grove ws status` to discover workspace context
- `grove ws worktree ...` to create and manage worktrees
- the `PreToolUse` hook declared at `plugins/grove/hooks/hooks.json` to steer the agent away from raw `git worktree`

This keeps the `grove` CLI as the source of truth. MCP support remains available,
but Codex does not depend on it for the primary workflow.

Codex discovers plugin-bundled hooks at `hooks/hooks.json` by default, so
`plugins/grove/.codex-plugin/plugin.json` intentionally does not include a
`hooks` field. The hook command resolves through
`${PLUGIN_ROOT}/hooks/reject-git-worktree.ts codex`; Claude Code support
remains separate in `plugins/grove/.claude-plugin/plugin.json` and resolves
through `${CLAUDE_PLUGIN_ROOT}/hooks/reject-git-worktree.ts claude`. The shared
entrypoint dispatches to runner-specific payload handlers and all handlers use
the same git worktree policy.

To use the local plugin in Codex from this Grove workspace, add the repository
root as a local marketplace source and install the `grove` entry:

```bash
cd <your-grove-workspace>
codex plugin marketplace add <path-to-grove-repo-main-tree>
codex plugin add grove@grove
```

Codex resolves `.agents/plugins/marketplace.json` from that marketplace root and
then resolves the plugin `source.path` relative to the root. After installing or
reinstalling, start a new Codex thread in your Grove workspace and run `/hooks`
to review and trust the Grove `PreToolUse` hook from
`plugins/grove/hooks/hooks.json`. Codex skips non-managed command hooks until
they are trusted and requires review again when a hook definition changes.

## Development

```bash
bun install          # install deps
bun test             # run tests
bun run build        # compile to bin/grove
bun run format       # format + lint (biome)
bun run typecheck    # tsc --noEmit
```

See [CLAUDE.md](CLAUDE.md) for architecture, data model, and development guidelines.
