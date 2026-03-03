#!/usr/bin/env bun

import { execCommand, type StandardCommand } from "./commands/exec";
import { addRepo, listRepos, removeRepo } from "./commands/repo";
import { getStatus } from "./commands/status";
import { addWorkspace, listWorkspaces, removeWorkspace, syncWorkspace } from "./commands/workspace";
import { addWorktree, listWorktrees, pruneWorktrees, removeWorktree } from "./commands/worktree";
import { createPaths, DEFAULT_WORKSPACES_ROOT } from "./constants";
import { inferContext } from "./context";
import { discoverDaemon, startDaemon } from "./lib/daemon";
import { ok, type Result } from "./types";

// ---- Output helpers ----

function output(result: Result<unknown>, porcelain: boolean, formatFn?: (val: unknown) => string) {
  if (result.ok) {
    if (porcelain && formatFn) {
      process.stdout.write(formatFn(result.value));
    } else {
      console.log(JSON.stringify({ ok: true, data: result.value }));
    }
  } else {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: result.error, code: result.code })}\n`,
    );
    process.exit(1);
  }
}

function formatWorkspaceList(val: unknown): string {
  const list = val as Array<{ name: string }>;
  return list.map((w) => w.name).join("\n") + (list.length ? "\n" : "");
}

function formatRepoList(val: unknown): string {
  const list = val as Array<{ name: string; path: string; status: string }>;
  return (
    list.map((r) => `${r.name}\t${r.path}\t${r.status}`).join("\n") + (list.length ? "\n" : "")
  );
}

function formatWorktreeList(val: unknown): string {
  const list = val as Array<{ repo: string; slug: string; branch: string; type: string }>;
  return (
    list.map((w) => `${w.repo}\t${w.slug}\t${w.branch}\t${w.type}`).join("\n") +
    (list.length ? "\n" : "")
  );
}

// ---- Arg parsing ----
// Flat parse: extract all --flags and all positional args from the full argv

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>; // --flag or --flag value
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // If next arg is not a flag, consume it as the value
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function flag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  const v = parsed.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

// ---- Deprecation helpers ----

function warnDeprecatedEnv(oldVar: string, newVar: string): void {
  const val = process.env[oldVar];
  if (!process.env[newVar] && val) {
    const safeVal = JSON.stringify(String(val));
    process.stderr.write(
      `[grove] Warning: ${oldVar}=${safeVal} is deprecated. Rename it to ${newVar}=${safeVal}.\n`,
    );
  }
}

function resolveWorkspace(
  parsed: ParsedArgs,
  ctxWorkspace: string | undefined,
): string | undefined {
  warnDeprecatedEnv("DOTCLAUDE_WORKSPACE", "GROVE_WORKSPACE");
  return (
    flagValue(parsed, "workspace") ||
    process.env.GROVE_WORKSPACE ||
    process.env.DOTCLAUDE_WORKSPACE ||
    ctxWorkspace
  );
}

// ---- Main ----

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: grove <ws|workspaces> <subcommand> [args...]");
    process.exit(1);
  }

  const root = process.env.GROVE_ROOT || process.env.DOTCLAUDE_ROOT || DEFAULT_WORKSPACES_ROOT;
  warnDeprecatedEnv("DOTCLAUDE_ROOT", "GROVE_ROOT");
  const paths = createPaths(root);
  const ctx = await inferContext(process.env.PWD ?? process.cwd(), root);

  // argv[0] = cmd
  const cmd = argv[0];

  // ── mcp-server subcommand ────────────────────────────────────────
  if (cmd === "mcp-server") {
    const parsed = parseArgs(argv.slice(1));
    const workspaceName = resolveWorkspace(parsed, ctx.workspace);
    const portArg = flagValue(parsed, "port");
    const port = portArg !== undefined ? parseInt(portArg, 10) : 0;
    if (portArg !== undefined && (Number.isNaN(port) || port < 0 || port > 65535)) {
      console.error(`Invalid port: ${portArg}`);
      process.exit(1);
    }

    if (!workspaceName) {
      console.error(
        "Usage: grove mcp-server [--workspace <name>] [--port <port>]\n" +
          "  Workspace must be specified via --workspace, GROVE_WORKSPACE env, or inferred from cwd.",
      );
      process.exit(1);
    }

    // Check if already running
    const existing = await discoverDaemon(workspaceName, paths);
    if (existing) {
      process.stderr.write(`[mcp-server] already running at ${existing.url}\n`);
      process.exit(0);
    }

    const info = await startDaemon({ workspace: workspaceName, paths, port });
    process.stderr.write(`[mcp-server] listening at ${info.url}\n`);

    // Keep process alive — daemon runs until shutdown signal
    await new Promise<void>(() => {});
    return;
  }

  // ── ws exec subcommand ───────────────────────────────────────────
  if (cmd === "ws" && argv[1] === "exec") {
    const parsed = parseArgs(argv.slice(2));
    const workspaceName = resolveWorkspace(parsed, ctx.workspace);
    const command = parsed.positional[0] as StandardCommand | undefined;

    if (!workspaceName) {
      console.error(
        "Usage: grove ws exec <command> [file] [--match <pattern>] [--repo <name>] [--dry-run]",
      );
      process.exit(1);
    }
    if (!command) {
      console.error("Usage: grove ws exec <setup|format|test|check|test:file|test:match>");
      process.exit(1);
    }

    const file = parsed.positional[1];
    const result = await execCommand(
      workspaceName,
      command,
      {
        file,
        match: flagValue(parsed, "match"),
        repo: flagValue(parsed, "repo"),
        dryRun: flag(parsed, "dry-run"),
      },
      paths,
    );

    if (!result.ok) {
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: result.error, code: result.code })}\n`,
      );
      process.exit(1);
    }

    const { exitCode, stdout, stderr, command: cmd2, repo, cwd } = result.value;
    if (flag(parsed, "dry-run")) {
      process.stdout.write(`${JSON.stringify({ repo, cwd, command: cmd2 })}\n`);
      process.exit(0);
    }
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
    process.exit(exitCode);
  }

  if (cmd !== "workspaces" && cmd !== "ws") {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }

  const subcmd = argv[1];
  if (!subcmd) {
    console.error("Usage: grove ws <add|list|remove|repo|worktree|status|path|sync>");
    process.exit(1);
  }

  // Parse everything after the subcommand
  const parsed = parseArgs(argv.slice(2));
  const porcelain = flag(parsed, "porcelain");
  const effectiveWorkspace = resolveWorkspace(parsed, ctx.workspace);

  switch (subcmd) {
    case "add": {
      const name = parsed.positional[0];
      if (!name) {
        console.error("Usage: grove ws add <name>");
        process.exit(1);
      }
      output(await addWorkspace(name, paths), porcelain);
      break;
    }

    case "list": {
      output(await listWorkspaces(paths), porcelain, formatWorkspaceList);
      break;
    }

    case "remove": {
      const name = parsed.positional[0] ?? effectiveWorkspace;
      if (!name) {
        console.error("Usage: grove ws remove <name>");
        process.exit(1);
      }
      output(await removeWorkspace(name, { force: flag(parsed, "force") }, paths), porcelain);
      break;
    }

    case "repo": {
      const repoSubcmd = parsed.positional[0];
      const repoArgs = parsed.positional.slice(1);

      switch (repoSubcmd) {
        case "add": {
          // [workspace] <path> [--name override]
          let workspace: string;
          let repoPath: string;
          if (repoArgs.length >= 2) {
            workspace = repoArgs[0];
            repoPath = repoArgs[1];
          } else {
            workspace = effectiveWorkspace ?? "";
            repoPath = repoArgs[0];
          }
          if (!workspace || !repoPath) {
            console.error("Usage: grove ws repo add [workspace] <path> [--name override]");
            process.exit(1);
          }
          output(await addRepo(workspace, repoPath, flagValue(parsed, "name"), paths), porcelain);
          break;
        }

        case "list": {
          const workspace = repoArgs[0] ?? effectiveWorkspace;
          if (!workspace) {
            console.error("Usage: grove ws repo list [workspace]");
            process.exit(1);
          }
          output(await listRepos(workspace, paths), porcelain, formatRepoList);
          break;
        }

        case "remove": {
          let workspace: string;
          let repoName: string;
          if (repoArgs.length >= 2) {
            workspace = repoArgs[0];
            repoName = repoArgs[1];
          } else {
            workspace = effectiveWorkspace ?? "";
            repoName = repoArgs[0];
          }
          if (!workspace || !repoName) {
            console.error("Usage: grove ws repo remove [workspace] <name>");
            process.exit(1);
          }
          output(
            await removeRepo(workspace, repoName, { force: flag(parsed, "force") }, paths),
            porcelain,
          );
          break;
        }

        default:
          console.error(`Unknown repo subcommand: ${repoSubcmd}`);
          process.exit(1);
      }
      break;
    }

    case "worktree": {
      const wtSubcmd = parsed.positional[0];
      const wtArgs = parsed.positional.slice(1);

      switch (wtSubcmd) {
        case "add": {
          // [repo] <branch> [--from base] [--new]
          let repo: string;
          let branch: string;
          if (wtArgs.length >= 2) {
            repo = wtArgs[0];
            branch = wtArgs[1];
          } else {
            repo = ctx.repo ?? "";
            branch = wtArgs[0];
          }
          const workspace = effectiveWorkspace ?? "";
          if (!workspace || !repo || !branch) {
            console.error("Usage: grove ws worktree add [repo] <branch> [--from base] [--new]");
            process.exit(1);
          }
          output(
            await addWorktree(
              workspace,
              repo,
              branch,
              {
                newBranch: flag(parsed, "new"),
                from: flagValue(parsed, "from"),
                noSetup: flag(parsed, "no-setup"),
              },
              paths,
            ),
            porcelain,
          );
          break;
        }

        case "list": {
          const workspace = effectiveWorkspace ?? "";
          const repo = wtArgs[0] ?? ctx.repo;
          if (!workspace || !repo) {
            console.error("Usage: grove ws worktree list [repo]");
            process.exit(1);
          }
          output(await listWorktrees(workspace, repo, paths), porcelain, formatWorktreeList);
          break;
        }

        case "remove": {
          const workspace = effectiveWorkspace ?? "";
          let repo: string;
          let slug: string;
          if (wtArgs.length >= 2) {
            repo = wtArgs[0];
            slug = wtArgs[1];
          } else {
            repo = ctx.repo ?? "";
            slug = wtArgs[0];
          }
          if (!workspace || !repo || !slug) {
            console.error("Usage: grove ws worktree remove [repo] <slug> [--force]");
            process.exit(1);
          }
          output(
            await removeWorktree(workspace, repo, slug, { force: flag(parsed, "force") }, paths),
            porcelain,
          );
          break;
        }

        case "prune": {
          const workspace = effectiveWorkspace ?? "";
          if (!workspace) {
            console.error("Usage: grove ws worktree prune");
            process.exit(1);
          }
          output(await pruneWorktrees(workspace, paths), porcelain);
          break;
        }

        default:
          console.error(`Unknown worktree subcommand: ${wtSubcmd}`);
          process.exit(1);
      }
      break;
    }

    case "status": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        console.error("Usage: grove ws status [workspace]");
        process.exit(1);
      }
      output(await getStatus(workspace, paths), porcelain);
      break;
    }

    case "sync": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        console.error("Usage: grove ws sync [workspace]");
        process.exit(1);
      }
      output(await syncWorkspace(workspace, paths), porcelain);
      break;
    }

    case "path": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        console.error("Usage: grove ws path [workspace]");
        process.exit(1);
      }
      output(ok({ path: paths.workspace(workspace) }), porcelain, (val) => {
        const { path } = val as { path: string };
        return `${path}\n`;
      });
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcmd}`);
      process.exit(1);
  }
}

await main().catch((e) => {
  console.error(e);
  process.exit(1);
});
