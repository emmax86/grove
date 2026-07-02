import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exists, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { TouchContext } from "../../commands/context";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { addWorktree } from "../../commands/worktree";
import { createPaths } from "../../constants";
import { discoverDaemon, startDaemon } from "../../lib/daemon";
import type { Result } from "../../types";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

// ── Layer 1: filesystem / discovery ─────────────────────────────────────────

describe("discoverDaemon", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterEach(() => cleanup(tempDir));

  it("returns null when no discovery file exists", async () => {
    await addWorkspace("ws", paths);
    const result = await discoverDaemon("ws", paths);
    expect(result).toBeNull();
  });

  it("returns null and deletes stale file when pid does not exist", async () => {
    await addWorkspace("ws", paths);
    const configPath = paths.daemonConfig("ws");
    // PID 999999999 is extremely unlikely to exist
    await writeFile(
      configPath,
      JSON.stringify({ url: "http://127.0.0.1:9999/mcp", pid: 999999999 }),
    );

    const result = await discoverDaemon("ws", paths);
    expect(result).toBeNull();
    expect(await exists(configPath)).toBe(false);
  });

  it("returns null and deletes stale file when health check fails", async () => {
    await addWorkspace("ws", paths);
    const configPath = paths.daemonConfig("ws");
    // Use our own PID (exists) but a port with nothing listening
    await writeFile(
      configPath,
      JSON.stringify({ url: "http://127.0.0.1:1/mcp", pid: process.pid }),
    );

    const result = await discoverDaemon("ws", paths);
    expect(result).toBeNull();
    expect(await exists(configPath)).toBe(false);
  });
});

// ── Layer 2: HTTP integration ────────────────────────────────────────────────

describe("startDaemon", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let stopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterEach(async () => {
    await stopFn?.();
    stopFn = null;
    await cleanup(tempDir);
  });

  it("throws when workspace does not exist", async () => {
    await addWorkspace("ws", paths);
    await expect(startDaemon({ workspace: "nonexistent", paths })).rejects.toThrow();
  });

  it("writes discovery file with url and pid", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;

    const configPath = paths.daemonConfig("ws");
    expect(await exists(configPath)).toBe(true);
    const data = JSON.parse(await readFile(configPath, "utf8"));
    expect(data.url).toBe(info.url);
    expect(data.pid).toBe(process.pid);
  });

  it("binds to 127.0.0.1 (not 0.0.0.0)", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("GET /health returns workspace name and pid", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;
    const healthUrl = info.url.replace("/mcp", "/health");

    const res = await fetch(healthUrl);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      ok: boolean;
      workspace: string;
      pid: number;
      sessions: number;
    };
    expect(body.ok).toBe(true);
    expect(body.workspace).toBe("ws");
    expect(body.pid).toBe(process.pid);
    expect(typeof body.sessions).toBe("number");
  });

  it("discoverDaemon finds running daemon", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;

    const found = await discoverDaemon("ws", paths);
    expect(found).not.toBeNull();
    expect(found?.pid).toBe(process.pid);
  });

  it("stop() removes discovery file", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    const configPath = paths.daemonConfig("ws");

    expect(await exists(configPath)).toBe(true);
    await info.stop();
    stopFn = null;
    expect(await exists(configPath)).toBe(false);
  });

  it("closed resolves after stop() is called", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });

    let resolved = false;
    void info.closed.then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);

    await info.stop();
    stopFn = null;
    await info.closed;
    expect(resolved).toBe(true);
  });

  it("closed resolves when the grace timer fires with no sessions", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 100,
    });

    // No MCP session ever connects, so the grace timer started at boot fires
    // and shuts the daemon down on its own — closed must resolve.
    await info.closed;
    stopFn = null;
    expect(await exists(paths.daemonConfig("ws"))).toBe(false);
  });
});

// ── Layer 3: full MCP client flow ────────────────────────────────────────────

describe("MCP over HTTP", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let stopFn: (() => Promise<void>) | null = null;
  let clients: Client[] = [];

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) {
      try {
        await c.close();
      } catch {}
    }
    clients = [];
    await stopFn?.();
    stopFn = null;
    await cleanup(tempDir);
  });

  it("client connects and calls workspace_status tool", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;

    const client = new Client({ name: "test-client", version: "1.0.0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url)));

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("workspace_status");
    expect(names).toContain("workspace_path");

    const result = await client.callTool({
      name: "workspace_status",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.name).toBe("ws");
  });

  it("two clients connect independently", async () => {
    await addWorkspace("ws", paths);
    const info = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 5000,
    });
    stopFn = info.stop;

    const clientA = new Client({ name: "client-a", version: "1.0.0" });
    const clientB = new Client({ name: "client-b", version: "1.0.0" });
    clients.push(clientA, clientB);

    await clientA.connect(new StreamableHTTPClientTransport(new URL(info.url)));
    await clientB.connect(new StreamableHTTPClientTransport(new URL(info.url)));

    const [resA, resB] = await Promise.all([
      clientA.callTool({ name: "workspace_path", arguments: {} }),
      clientB.callTool({ name: "workspace_path", arguments: {} }),
    ]);

    expect(resA.isError).toBeFalsy();
    expect(resB.isError).toBeFalsy();
  });
});

// ── Layer 4: context disclosure endpoints ────────────────────────────────────

describe("daemon context disclosure endpoints", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let stopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    const repoPath = await createTestGitRepo(tempDir, "api");
    await addWorkspace("ws", paths);
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);
    await addWorktree("ws", "api", "feature/auth", { newBranch: true }, paths, GIT_ENV);
    const featureRoot = paths.worktreeDir("ws", "api", "feature-auth");
    await writeFile(join(featureRoot, "AGENTS.md"), "# feature root\n");
  });

  afterEach(async () => {
    await stopFn?.();
    stopFn = null;
    await cleanup(tempDir);
  });

  async function startTestDaemon() {
    const info = await startDaemon({ workspace: "ws", paths, gracePeriodMs: 5000 });
    stopFn = info.stop;
    return info;
  }

  function touchUrl(info: { url: string }): string {
    return info.url.replace("/mcp", "/touch");
  }

  function sessionsUrl(info: { url: string }): string {
    return info.url.replace("/mcp", "/sessions");
  }

  async function postTouch(
    info: { url: string },
    body: { paths: string[]; session?: string; refresh?: boolean; cwd: string },
  ): Promise<Result<TouchContext>> {
    const res = await fetch(touchUrl(info), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Result<TouchContext>;
  }

  it("POST /touch with a session key dedups across calls", async () => {
    const info = await startTestDaemon();
    const cwd = paths.workspace("ws");

    const first = await postTouch(info, {
      paths: ["trees/api/feature-auth"],
      session: "hook-1",
      cwd,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.entries.length).toBeGreaterThan(0);
    expect(first.value.entries.every((e) => e.status === "served")).toBe(true);

    const second = await postTouch(info, {
      paths: ["trees/api/feature-auth"],
      session: "hook-1",
      cwd,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.entries.every((e) => e.status === "current")).toBe(true);
  });

  it("distinct session keys hold distinct ledgers", async () => {
    const info = await startTestDaemon();
    const cwd = paths.workspace("ws");

    const a = await postTouch(info, {
      paths: ["trees/api/feature-auth"],
      session: "session-a",
      cwd,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) {
      return;
    }
    expect(a.value.entries.every((e) => e.status === "served")).toBe(true);

    const b = await postTouch(info, {
      paths: ["trees/api/feature-auth"],
      session: "session-b",
      cwd,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) {
      return;
    }
    expect(b.value.entries.every((e) => e.status === "served")).toBe(true);
  });

  it("GET /sessions lists cli-keyed ledgers with served entries", async () => {
    const info = await startTestDaemon();
    const cwd = paths.workspace("ws");

    await postTouch(info, { paths: ["trees/api/feature-auth"], session: "hook-1", cwd });

    const res = await fetch(sessionsUrl(info));
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      sessions: {
        key: string;
        kind: "mcp" | "cli";
        entries: { contextKey: string; contentHash: string }[];
      }[];
    };
    const cliSession = body.sessions.find((s) => s.kind === "cli" && s.key === "hook-1");
    expect(cliSession).toBeDefined();
    expect(cliSession?.entries.length).toBeGreaterThan(0);
  });

  it("POST /touch without session is stateless (served both times)", async () => {
    const info = await startTestDaemon();
    const cwd = paths.workspace("ws");

    const first = await postTouch(info, { paths: ["trees/api/feature-auth"], cwd });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.entries.every((e) => e.status === "served")).toBe(true);

    const second = await postTouch(info, { paths: ["trees/api/feature-auth"], cwd });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.entries.every((e) => e.status === "served")).toBe(true);
  });
});
