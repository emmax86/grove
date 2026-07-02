// Thin client wrappers around context disclosure operations. Kept out of
// commands/context.ts deliberately: once daemon routing lands (a future task)
// these will import `discoverDaemon` from `lib/daemon`, and `lib/daemon`
// imports `touchContext` from `commands/context` — putting the wrappers here
// avoids that import cycle.
import type { Paths } from "../constants";
import { DisclosureRecorder } from "../lib/context-state";
import { err, type Result } from "../types";
import { type TouchContext, touchContext } from "./context";

export interface RunContextTouchOptions {
  cwd: string;
  refresh?: boolean;
  /** Session key for the served-ledger. Unused in the stateless (no-daemon) path. */
  session?: string;
}

/**
 * Stateless touch: no ledger (every scope serves fresh every call), recorded
 * to the workspace's on-disk disclosure journal for observability.
 */
export async function runContextTouch(
  workspace: string,
  targetPaths: string[],
  options: RunContextTouchOptions,
  paths: Paths,
): Promise<Result<TouchContext>> {
  const recorder = new DisclosureRecorder(paths.contextStateDir(workspace));
  return touchContext(
    workspace,
    targetPaths,
    {
      cwd: options.cwd,
      refresh: options.refresh,
      recorder,
      trigger: "cli",
    },
    paths,
  );
}

export interface ContextSessionScope {
  contextKey: string;
  contentHash: string;
}

export interface ContextSessionEntry {
  session: string;
  scopes: ContextSessionScope[];
}

export interface ContextSessionsValue {
  workspace: string;
  sessions: ContextSessionEntry[];
}

/**
 * Session listing requires a running daemon (in-memory session ledgers).
 * There is no daemon routing yet, so this always reports none running.
 */
export async function listContextSessions(
  _workspace: string,
  _paths: Paths,
): Promise<Result<ContextSessionsValue>> {
  return err("No daemon running", "DAEMON_NOT_RUNNING");
}
