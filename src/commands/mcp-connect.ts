import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Paths } from "../constants";
import { discoverDaemon } from "../lib/daemon";

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

  // Auto-start: spawn ourselves detached. process.execPath is the bun binary
  // (or the compiled grove binary); re-run the CLI entrypoint with mcp-server.
  const command = [
    process.execPath,
    ...(process.argv[1] ? [process.argv[1]] : []),
    "mcp-server",
    "--workspace",
    workspace,
  ];
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

  // The SDK stdio transport only listens for stdin 'data'/'error' — it never
  // detects stdin EOF/close, so an ungraceful harness (parent) death would
  // orphan this bridge AND leave its MCP session open on the daemon forever
  // (the daemon's grace timer only starts once sessions hit 0). Exit as soon
  // as our stdin goes away; dropping the HTTP connection closes the daemon's
  // session transport, which lets the daemon grace-shutdown normally.
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));

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
  stdio.onclose = () => void http.close();
  http.onclose = () => process.exit(0);
  stdio.onerror = (e) => process.stderr.write(`[mcp-connect] stdio error: ${e}\n`);
  http.onerror = (e) => {
    // A fatal HTTP transport error means the daemon link is dead; tear down the
    // stdio side and exit non-zero rather than lingering as a half-open bridge.
    process.stderr.write(`[mcp-connect] http error: ${e}\n`);
    void stdio.close();
    process.exit(1);
  };

  // start() on the HTTP client only sets up its AbortController; it is safe to
  // call before the first send() and does not itself open the session.
  await http.start();
  await stdio.start();
  await new Promise<void>(() => {}); // run until a transport closes
}
