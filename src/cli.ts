#!/usr/bin/env bun

import { relative } from "node:path";

import { execCommand, type StandardCommand } from "./commands/exec";
import { addRepo, listRepos, removeRepo } from "./commands/repo";
import { getStatus } from "./commands/status";
import { addWorkspace, listWorkspaces, removeWorkspace, syncWorkspace } from "./commands/workspace";
import { addWorktree, listWorktrees, pruneWorktrees, removeWorktree } from "./commands/worktree";
import { createPaths, DEFAULT_WORKSPACES_ROOT } from "./constants";
import { inferContext } from "./context";
import { discoverDaemon, startDaemon } from "./lib/daemon";
import { buildMissingArgPayload, isHelpRequested, resolveCommandPath } from "./lib/help/dispatch";
import { GLOBAL_FLAGS, REGISTRY } from "./lib/help/registry";
import type { HelpView } from "./lib/render";
import { type CommandKind, type RenderContext, render } from "./lib/render";
import { resolveRenderContext } from "./lib/render/flags";
import { err, ok, type Result } from "./types";

// ---- Output helpers ----

function emit<T>(result: Result<T>, kind: CommandKind, ctx: RenderContext): never {
  const { stdout, stderr, exitCode } = render(result, kind, ctx);
  if (stdout) {
    process.stdout.write(`${stdout}\n`);
  }
  if (stderr) {
    process.stderr.write(`${stderr}\n`);
  }
  process.exit(exitCode);
}

function emitMissingArg(
  argName: string,
  commandPath: readonly string[],
  ctx: RenderContext,
): never {
  const payload = buildMissingArgPayload(argName, commandPath);
  const { stdout, stderr, exitCode } = render(payload, "help", ctx);
  if (stdout) {
    process.stdout.write(`${stdout}\n`);
  }
  if (stderr) {
    process.stderr.write(`${stderr}\n`);
  }
  process.exit(exitCode);
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
      // mcp-server runs before renderCtx is resolved; build a minimal fallback ctx
      const mcpCtx: RenderContext = {
        mode: "text",
        colorEnabled: false,
        unicodeEnabled: true,
        isTTY: Boolean(process.stdout.isTTY),
        isStderrTTY: Boolean(process.stderr.isTTY),
        warnings: [],
      };
      emitMissingArg("workspace", ["mcp-server"], mcpCtx);
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

  // Resolve render context once — used by all subcommands including ws exec
  const ctxResult = resolveRenderContext({
    argv,
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
    isStderrTTY: Boolean(process.stderr.isTTY),
  });
  if (!ctxResult.ok) {
    emit(ctxResult, "workspace-list", {
      mode: "text",
      colorEnabled: false,
      unicodeEnabled: true,
      isTTY: Boolean(process.stdout.isTTY),
      isStderrTTY: Boolean(process.stderr.isTTY),
      warnings: [],
    });
  }
  const renderCtx = ctxResult.value;

  if (renderCtx.mode === "text") {
    for (const warning of renderCtx.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
  }

  // ── help interceptor ─────────────────────────────────────────────
  if (argv.length === 0 || isHelpRequested(argv, REGISTRY)) {
    const result = resolveCommandPath(argv, REGISTRY);
    const view: HelpView = {
      path: result.path,
      node: result.node,
      globalFlags: GLOBAL_FLAGS,
      note:
        result.unmatched.length > 0
          ? `unknown subcommand '${result.unmatched.join(" ")}' under '${result.path.join(" ")}' — showing help for \`${result.path.join(" ")}\``
          : undefined,
    };
    emit(ok(view), "help", renderCtx);
  }

  // ── ws exec subcommand ───────────────────────────────────────────
  if (cmd === "ws" && argv[1] === "exec") {
    const parsed = parseArgs(argv.slice(2));
    const workspaceName = resolveWorkspace(parsed, ctx.workspace);
    const command = parsed.positional[0] as StandardCommand | undefined;

    if (!workspaceName) {
      emitMissingArg("workspace", ["ws", "exec"], renderCtx);
    }
    if (!command) {
      emitMissingArg("command", ["ws", "exec"], renderCtx);
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
      emit(result, "exec-dry-run", renderCtx);
    }

    const { exitCode, stdout, stderr, command: cmd2, repo, cwd } = result.value;
    if (flag(parsed, "dry-run")) {
      emit(ok({ repo, cwd, command: cmd2 }), "exec-dry-run", renderCtx);
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
    emit(err(`unknown command '${cmd}'`, "UNKNOWN_COMMAND"), "workspace-list", renderCtx);
  }

  const subcmd = argv[1];
  if (!subcmd) {
    emitMissingArg("subcommand", ["ws"], renderCtx);
  }

  // Parse everything after the subcommand
  const parsed = parseArgs(argv.slice(2));
  const effectiveWorkspace = resolveWorkspace(parsed, ctx.workspace);

  switch (subcmd) {
    case "add": {
      const name = parsed.positional[0];
      if (!name) {
        emitMissingArg("name", ["ws", "add"], renderCtx);
      }
      emit(await addWorkspace(name, paths), "workspace-add", renderCtx);
      break;
    }

    case "list": {
      emit(await listWorkspaces(paths), "workspace-list", renderCtx);
      break;
    }

    case "remove": {
      const name = parsed.positional[0] ?? effectiveWorkspace;
      if (!name) {
        emitMissingArg("name", ["ws", "remove"], renderCtx);
      }
      emit(
        await removeWorkspace(name, { force: flag(parsed, "force") }, paths),
        "workspace-remove",
        renderCtx,
      );
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
            emitMissingArg("path", ["ws", "repo", "add"], renderCtx);
          }
          // addRepo returns {name,path,status,defaultBranch,defaultBranchSlug}; formatter also needs workspace and worktreePath
          const repoAddResult = await addRepo(
            workspace,
            repoPath,
            flagValue(parsed, "name"),
            paths,
          );
          if (repoAddResult.ok) {
            const wsDir = paths.workspace(workspace);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const wtDir = paths.worktreeDir(
              workspace,
              repoAddResult.value.name,
              repoAddResult.value.defaultBranchSlug!,
            );
            const worktreePath = relative(wsDir, wtDir);
            emit(ok({ ...repoAddResult.value, workspace, worktreePath }), "repo-add", renderCtx);
          } else {
            emit(repoAddResult, "repo-add", renderCtx);
          }
          break;
        }

        case "list": {
          const workspace = repoArgs[0] ?? effectiveWorkspace;
          if (!workspace) {
            emitMissingArg("workspace", ["ws", "repo", "list"], renderCtx);
          }
          emit(await listRepos(workspace, paths), "repo-list", renderCtx);
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
            emitMissingArg("name", ["ws", "repo", "remove"], renderCtx);
          }
          emit(
            await removeRepo(workspace, repoName, { force: flag(parsed, "force") }, paths),
            "repo-remove",
            renderCtx,
          );
          break;
        }

        default:
          emit(
            err(`unknown subcommand '${repoSubcmd}'`, "UNKNOWN_SUBCOMMAND"),
            "workspace-list",
            renderCtx,
          );
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
            emitMissingArg("branch", ["ws", "worktree", "add"], renderCtx);
          }
          const isNew = flag(parsed, "new");
          // adapter: addWorktree returns {repo,slug,branch,type,...extras}; formatter needs isNew and path
          const wtAddResult = await addWorktree(
            workspace,
            repo,
            branch,
            {
              newBranch: isNew,
              from: flagValue(parsed, "from"),
              noSetup: flag(parsed, "no-setup"),
            },
            paths,
          );
          if (wtAddResult.ok) {
            const wtPath = paths.worktreePoolEntry(wtAddResult.value.repo, wtAddResult.value.slug);
            emit(ok({ ...wtAddResult.value, path: wtPath, isNew }), "worktree-add", renderCtx);
          } else {
            emit(wtAddResult, "worktree-add", renderCtx);
          }
          break;
        }

        case "list": {
          const workspace = effectiveWorkspace ?? "";
          const repo = wtArgs[0] ?? ctx.repo;
          if (!workspace || !repo) {
            emitMissingArg("repo", ["ws", "worktree", "list"], renderCtx);
          }
          emit(await listWorktrees(workspace, repo, paths), "worktree-list", renderCtx);
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
            emitMissingArg("slug", ["ws", "worktree", "remove"], renderCtx);
          }
          emit(
            await removeWorktree(workspace, repo, slug, { force: flag(parsed, "force") }, paths),
            "worktree-remove",
            renderCtx,
          );
          break;
        }

        case "prune": {
          const workspace = effectiveWorkspace ?? "";
          if (!workspace) {
            emitMissingArg("workspace", ["ws", "worktree", "prune"], renderCtx);
          }
          // adapter: pruneWorktrees returns {pruned}; formatter needs {workspace, pruned}
          const pruneResult = await pruneWorktrees(workspace, paths);
          if (pruneResult.ok) {
            emit(ok({ workspace, pruned: pruneResult.value.pruned }), "worktree-prune", renderCtx);
          } else {
            emit(pruneResult, "worktree-prune", renderCtx);
          }
          break;
        }

        default:
          emit(
            err(`unknown subcommand '${wtSubcmd}'`, "UNKNOWN_SUBCOMMAND"),
            "workspace-list",
            renderCtx,
          );
      }
      break;
    }

    case "status": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        emitMissingArg("workspace", ["ws", "status"], renderCtx);
      }
      emit(await getStatus(workspace, paths), "status", renderCtx);
      break;
    }

    case "sync": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        emitMissingArg("workspace", ["ws", "sync"], renderCtx);
      }
      const syncResult = await syncWorkspace(workspace, paths);
      if (syncResult.ok) {
        emit(ok({ name: workspace, ...syncResult.value }), "workspace-sync", renderCtx);
      } else {
        emit(syncResult, "workspace-sync", renderCtx);
      }
      break;
    }

    case "path": {
      const workspace = parsed.positional[0] ?? effectiveWorkspace;
      if (!workspace) {
        emitMissingArg("workspace", ["ws", "path"], renderCtx);
      }
      emit(ok({ path: paths.workspace(workspace) }), "workspace-path", renderCtx);
      break;
    }

    default:
      emit(
        err(`unknown subcommand '${subcmd}'`, "UNKNOWN_SUBCOMMAND"),
        "workspace-list",
        renderCtx,
      );
  }
}

await main().catch((e) => {
  console.error(e);
  process.exit(1);
});
