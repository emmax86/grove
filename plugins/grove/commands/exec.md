---
description: Run a standard command (setup, format, test, test:file, test:match, check) in a repo
argument-hint: <command> [file] [--match <pattern>] [--repo <name>] [--dry-run]
allowed-tools: Bash(grove ws exec *)
---

Run the grove exec subcommand with the provided arguments:

```
grove ws exec $ARGUMENTS
```

## Commands

- `setup` — install dependencies (e.g. `bun install`, `uv sync`)
- `format` — format and lint code
- `test` — run the full test suite
- `test:file <file>` — run tests for a single file
- `test:match [file] --match <pattern>` — run tests matching a pattern
- `check` — typecheck the project

## Options

- `--repo <name>` — target a specific repo (otherwise inferred from file path)
- `--dry-run` — resolve and print the command without executing it

## Notes

- `setup`, `format`, and `test` are auto-detected from lockfiles (`bun.lock` → bun, `uv.lock` → uv, etc.)
- `test:file`, `test:match`, and `check` require a per-repo `.grove/commands.json` entry (otherwise `COMMAND_NOT_CONFIGURED`)
- Per-repo `.grove/commands.json` overrides take precedence over auto-detection
- The `file` argument triggers repo resolution from the file path
- When `--repo` is omitted and no file is given, the command fails with `REPO_NOT_RESOLVED`

Run the command and report the result. If it fails, show the error message and error code.
