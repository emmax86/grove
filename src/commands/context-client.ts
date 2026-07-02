// Thin client wrappers around context disclosure operations. Kept out of
// commands/context.ts deliberately: `runContextTouch`/`listContextSessions`
// import `discoverDaemon` from `lib/daemon`, and `lib/daemon` imports
// `touchContext` from `commands/context` — putting the wrappers here avoids
// that import cycle.
import type { Paths } from "../constants";
import { DisclosureRecorder } from "../lib/context-state";
import { discoverDaemon } from "../lib/daemon";
import { err, ok, type Result } from "../types";
import { type TouchContext, touchContext } from "./context";

export interface RunContextTouchOptions {
  cwd: string;
  refresh?: boolean;
  /** Session key for the served-ledger. Routed to the daemon's cli-keyed ledger map. */
  session?: string;
}

const DAEMON_FETCH_TIMEOUT_MS = 5000;

/**
 * Touch context for the given paths. Routes to a running daemon when one is
 * discoverable (so `session` keys a persistent, in-memory ledger there);
 * falls back to a stateless local touch (no ledger — every scope serves
 * fresh) whenever no daemon is running or the daemon is unreachable. The
 * fallback must never throw — it is never worse than the pre-daemon status
 * quo.
 */
export async function runContextTouch(
  workspace: string,
  targetPaths: string[],
  options: RunContextTouchOptions,
  paths: Paths,
): Promise<Result<TouchContext>> {
  const daemon = await discoverDaemon(workspace, paths);
  if (daemon) {
    try {
      const res = await fetch(new URL("/touch", daemon.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: targetPaths,
          session: options.session,
          refresh: options.refresh,
          cwd: options.cwd,
        }),
        signal: AbortSignal.timeout(DAEMON_FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        return (await res.json()) as Result<TouchContext>;
      }
    } catch {
      // fall through to the stateless local path — never worse than status quo
    }
  }

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

interface DaemonSessionsResponse {
  sessions: { key: string; kind: "mcp" | "cli"; entries: ContextSessionScope[] }[];
}

/**
 * Session listing requires a running daemon (in-memory session ledgers are
 * the only record of served state — there is nothing to list statelessly).
 */
export async function listContextSessions(
  workspace: string,
  paths: Paths,
): Promise<Result<ContextSessionsValue>> {
  const daemon = await discoverDaemon(workspace, paths);
  if (!daemon) {
    return err("No daemon running", "DAEMON_NOT_RUNNING");
  }

  try {
    const res = await fetch(new URL("/sessions", daemon.url), {
      signal: AbortSignal.timeout(DAEMON_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return err("No daemon running", "DAEMON_NOT_RUNNING");
    }
    const body = (await res.json()) as DaemonSessionsResponse;
    return ok({
      workspace,
      sessions: body.sessions.map((s) => ({ session: s.key, scopes: s.entries })),
    });
  } catch {
    return err("No daemon running", "DAEMON_NOT_RUNNING");
  }
}
