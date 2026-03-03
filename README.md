# grove

CLI tool for managing named workspaces that group git repos and worktrees,
with auto-generated Claude Code and VS Code configuration.

- Named workspaces under `~/grove-workspaces/` (configurable via `GROVE_ROOT`)
- Register git repos, manage git worktrees in a shared pool across workspaces
- Auto-generates `CLAUDE.md`, `.claude/trees.md`, and `.code-workspace` files
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
grove ws worktree add my-api feat/auth --new
grove ws status
```

> **Note**: `worktree add` infers the workspace from CWD — run it from inside the
> workspace directory, or pass `--workspace myproject` explicitly.

`grove ws status` outputs a JSON snapshot:

```json
{
  "ok": true,
  "data": {
    "workspace": "myproject",
    "repos": [{ "name": "my-api", "path": "/path/to/my-api", "status": "ok" }],
    "worktrees": [
      {
        "repo": "my-api",
        "slug": "feat-auth",
        "branch": "feat/auth",
        "type": "pool"
      }
    ]
  }
}
```

## Commands

### Workspaces — `grove ws <command>`

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| `add <name>`              | Create a workspace                      |
| `list`                    | List workspaces                         |
| `remove <name> [--force]` | Remove a workspace                      |
| `status [workspace]`      | Repos + worktrees overview              |
| `path [workspace]`        | Print workspace path                    |
| `sync [workspace]`        | Repair symlinks, prune dangling entries |

### Repos — `grove ws repo <command>`

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| `add [workspace] <path> [--name N]`   | Register a git repo   |
| `list [workspace]`                    | List registered repos |
| `remove [workspace] <name> [--force]` | Unregister a repo     |

### Worktrees — `grove ws worktree <command>`

| Command                                     | Description                     |
| ------------------------------------------- | ------------------------------- |
| `add [repo] <branch> [--new] [--from base]` | Create a worktree (shared pool) |
| `list [repo]`                               | List worktrees                  |
| `remove [repo] <slug> [--force]`            | Remove a worktree               |
| `prune`                                     | Clean up dangling symlinks      |

### Other

| Command                                                                    | Description                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| `grove ws exec <cmd> (<file> \| --repo R) [--match <pattern>] [--dry-run]` | Run standard command (setup/test/format/check) |
| `grove mcp-server [--workspace W]`                                         | Start MCP server (top-level, not under `ws`)   |

Bracketed args are inferred from CWD. Override with `--workspace` flag or `GROVE_WORKSPACE` env var.

List commands output JSON by default. Pass `--porcelain` for tab-separated plaintext.

## Integrations

- **Claude Code plugin** — `.claude-plugin/` registers `/workspace`, `/workspace-status`, `/worktree`, `/repo` slash commands
- **MCP server** — `grove mcp-server` exposes workspace operations over MCP for AI tool integration
- **Auto-generated files** — adding/removing repos regenerates `CLAUDE.md`, `AGENTS.md`, `.claude/trees.md`, and `.code-workspace` to keep editor and agent configs in sync

## Development

```bash
bun install          # install deps
bun test             # run tests
bun run build        # compile to .bin/grove
bun run format       # format + lint (biome)
bun run typecheck    # tsc --noEmit
```

See [CLAUDE.md](CLAUDE.md) for architecture, data model, and development guidelines.
