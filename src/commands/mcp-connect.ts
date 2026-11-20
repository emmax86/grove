import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Paths } from "../constants";
import { discoverDaemon } from "../lib/daemon";

/**
 * Build the argv to re-invoke this CLI as the detached `mcp-server` daemon.
 *
 * Under `bun run src/cli.ts`, `process.execPath` is `bun` and `process.argv[1]`
 * is the script path. Under a `bun build --compile` standalone binary,
 * `process.execPath` is already the compiled `grove` executable and
 * `process.argv[1]` is Bun's virtual `/$bunfs/...` (or Windows `B:/~BUN/...`)
 * entrypoint — passing that virtual path back to the binary makes it treat the
 * path as an unknown command and fail immediately.
 */
export function buildDaemonCommand(
  workspace: string,
  execPath = process.execPath,
  argv1: string | null = process.argv[1] ?? null,
): string[] {
  const isCompiledEntry =
    !argv1 || argv1.startsWith("/$bunfs/") || /^[A-Za-z]:[/\\]~BUN[/\\]/.test(argv1);
  return [execPath, ...(isCompiledEntry ? [] : [argv1]), "mcp-server", "--workspace", workspace];
}

/**
 * Resolve the URL of the per-workspace MCP daemon, auto-starting it if absent.
 *
 * Discovery + health-checking is delegated to {@link discoverDaemon}. When no
 * healthy daemon is found we spawn one detached (re-invoking this CLI's
 * `mcp-server` entrypoint) and poll discovery until it comes up. The child is
 * fully detached (stdio ignored, unref'd) so the bridge process can exit
 * without taking the daemon down with it.
 */
async function ensureDaemon(workspace: string, paths: Paths): Promise<string> {
  const existing = await discoverDaemon(workspace, paths);
  if (existing) {
    return existing.url;
  }

  const command = buildDaemonCommand(workspace);
  const proc = Bun.spawn(command, {
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env as Record<string, string>,
  });
  proc.unref();

  // Poll discovery for up to ~15s (150 * 100ms). Generous but bounded: the
  // daemon has to boot bun, bind a port, and write its discovery file.
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const found = await discoverDaemon(workspace, paths);
    if (found) {
      return found.url;
    }
  }
  throw new Error(`Timed out waiting for grove daemon to start for workspace "${workspace}"`);
}

/**
 * Bridge MCP traffic between the harness (stdio) and the workspace daemon
 * (streamable HTTP).
 *
 * This is a raw transport pump: JSON-RPC messages read off the stdio server
 * transport are forwarded verbatim to the streamable-HTTP client transport and
 * vice versa. The HTTP transport manages the `mcp-session-id` header itself
 * (captured from the initialize response, replayed on subsequent requests), so
 * the pump stays stateless. Runs until either side closes.
 */
export async function runMcpConnect(workspace: string, paths: Paths): Promise<void> {
  const url = await ensureDaemon(workspace, paths);
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL(url));

  // Tear down the bridge, first releasing the daemon session. A dropped
  // HTTP/SSE connection alone does NOT release the daemon's session: the SDK
  // server transport only fires its session-closed callback on an explicit
  // HTTP DELETE (StreamableHTTPClientTransport.terminateSession sends it;
  // close() does not). Without the DELETE the daemon's sessions map never
  // returns to 0, its grace timer never (re)starts, and it never shuts down.
  // So on every teardown path we send terminateSession() before exiting.
  let tearingDown = false;
  const teardown = (code: number) => {
    if (tearingDown) {
      return;
    }
    tearingDown = true;
    http
      .terminateSession()
      .catch(() => {})
      .finally(() => process.exit(code));
  };

  // The SDK stdio transport only listens for stdin 'data'/'error' — it never
  // detects stdin EOF/close, so an ungraceful harness (parent) death must be
  // caught here or the bridge orphans and pins the daemon session open.
  process.stdin.on("end", () => teardown(0));
  process.stdin.on("close", () => teardown(0));

  stdio.onmessage = (message) => {
    http
      .send(message)
      .catch((e) => process.stderr.write(`[mcp-connect] upstream send failed: ${e}\n`));
  };
  http.onmessage = (message) => {
    stdio
      .send(message)
      .catch((e) => process.stderr.write(`[mcp-connect] downstream send failed: ${e}\n`));
  };
  stdio.onclose = () => teardown(0);
  http.onclose = () => process.exit(0);
  stdio.onerror = (e) => process.stderr.write(`[mcp-connect] stdio error: ${e}\n`);
  http.onerror = (e) => {
    // A fatal HTTP transport error means the daemon link is dead; tear down
    // (best-effort DELETE) and exit non-zero rather than linger half-open.
    process.stderr.write(`[mcp-connect] http error: ${e}\n`);
    teardown(1);
  };

  // start() on the HTTP client only sets up its AbortController; it is safe to
  // call before the first send() and does not itself open the session.
  await http.start();
  await stdio.start();
  await new Promise<void>(() => {}); // run until a transport closes
}
