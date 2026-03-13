import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { Paths } from "../constants.js";
import { createMcpServer } from "../mcp-server.js";
import { AsyncMutex } from "./mutex.js";

export interface DaemonOptions {
  workspace: string;
  paths: Paths;
  port?: number;
  gracePeriodMs?: number;
}

export interface DaemonInfo {
  url: string;
  pid: number;
  stop: () => Promise<void>;
}

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
}

export async function startDaemon(options: DaemonOptions): Promise<DaemonInfo> {
  const { workspace, paths, port = 0, gracePeriodMs = 30_000 } = options;

  const configPath = paths.workspaceConfig(workspace);
  try {
    await access(configPath);
  } catch {
    throw new Error(`Workspace not found: ${workspace}`);
  }

  const writeLock = new AsyncMutex();
  const sessions = new Map<string, Session>();
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  function startGraceTimer() {
    if (graceTimer) {
      clearTimeout(graceTimer);
    }
    graceTimer = setTimeout(() => shutdown(), gracePeriodMs);
  }

  function cancelGraceTimer() {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  }

  async function removeDiscoveryFile() {
    const discoveryPath = paths.daemonConfig(workspace);
    try {
      await unlink(discoveryPath);
    } catch {}
  }

  async function shutdown() {
    cancelGraceTimer();
    await removeDiscoveryFile();
    await httpServer.stop(true);
  }

  function onSessionClosed(sessionId: string) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    session?.server.close().catch((e) => {
      process.stderr.write(`[daemon] failed to close server for session ${sessionId}: ${e}\n`);
    });
    process.stderr.write(`[daemon] session closed: ${sessionId}, active: ${sessions.size}\n`);
    if (sessions.size === 0) {
      startGraceTimer();
    }
  }

  async function broadcastResourceListChanged() {
    await Promise.allSettled(
      Array.from(sessions.entries()).map(async ([id, { server }]) => {
        try {
          // McpServer.sendResourceListChanged() returns void; use the inner
          // Server instance (public readonly .server) for the async version.
          await server.server.sendResourceListChanged();
        } catch (e) {
          process.stderr.write(`[daemon] notification failed for session ${id}: ${e}\n`);
        }
      }),
    );
  }

  // Bind to loopback only. Discovery file at 0o600 prevents cross-user port discovery.
  // Any same-user process can still connect via port scanning — acceptable for a local dev tool.
  const httpServer = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({
          ok: true,
          workspace,
          pid: process.pid,
          sessions: sessions.size,
        });
      }

      if (url.pathname === "/mcp") {
        const sessionId = req.headers.get("mcp-session-id");

        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Unknown session" },
                id: null,
              }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            );
          }
          return session.transport.handleRequest(req);
        }

        // New session — create server+transport pair
        const server = createMcpServer(workspace, paths, {
          writeLock,
          onStateChange: broadcastResourceListChanged,
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server });
            cancelGraceTimer();
            process.stderr.write(`[daemon] session opened: ${id}\n`);
          },
          onsessionclosed: (id) => {
            if (sessions.has(id)) {
              onSessionClosed(id);
            }
          },
        });

        await server.connect(transport);
        return transport.handleRequest(req);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const boundPort = httpServer.port;
  const mcpUrl = `http://127.0.0.1:${boundPort}/mcp`;
  const discoveryPath = paths.daemonConfig(workspace);

  await mkdir(paths.workspaceClaudeDir(workspace), { recursive: true });
  await writeFile(discoveryPath, JSON.stringify({ url: mcpUrl, pid: process.pid }), {
    mode: 0o600,
  });
  process.stderr.write(`[daemon] started: ${mcpUrl} pid=${process.pid}\n`);

  // Start grace timer — no sessions yet
  startGraceTimer();

  const sigHandler = () => void shutdown().then(() => process.exit(0));
  process.on("SIGINT", sigHandler);
  process.on("SIGTERM", sigHandler);

  return {
    url: mcpUrl,
    pid: process.pid,
    stop: async () => {
      process.off("SIGINT", sigHandler);
      process.off("SIGTERM", sigHandler);
      await shutdown();
    },
  };
}

export async function discoverDaemon(workspace: string, paths: Paths): Promise<DaemonInfo | null> {
  const discoveryPath = paths.daemonConfig(workspace);

  try {
    await access(discoveryPath);
  } catch {
    return null;
  }

  let data: { url: string; pid: number };
  try {
    data = JSON.parse(await readFile(discoveryPath, "utf8")) as {
      url: string;
      pid: number;
    };
  } catch {
    return null;
  }

  // Check process exists
  try {
    process.kill(data.pid, 0);
  } catch {
    await unlink(discoveryPath).catch(() => {});
    return null;
  }

  // Health check
  const port = new URL(data.url).port;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  let health: { ok: boolean; workspace: string };
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      throw new Error("unhealthy");
    }
    health = (await res.json()) as { ok: boolean; workspace: string };
  } catch {
    await unlink(discoveryPath).catch(() => {});
    return null;
  }

  if (!health.ok || health.workspace !== workspace) {
    await unlink(discoveryPath).catch(() => {});
    return null;
  }

  return {
    url: data.url,
    pid: data.pid,
    stop: async () => {}, // discovery doesn't own the daemon
  };
}
