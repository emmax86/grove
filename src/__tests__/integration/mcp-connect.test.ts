import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exists, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { buildDaemonCommand } from "../../commands/mcp-connect";
import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { createPaths } from "../../constants";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

const CLI_PATH = join(import.meta.dir, "../../cli.ts");
const COMPILED_BIN = join(import.meta.dir, "../../../bin/grove");

describe("buildDaemonCommand", () => {
  it("includes script argv[1] when running under bun", () => {
    expect(buildDaemonCommand("ws", "/usr/bin/bun", "/repo/src/cli.ts")).toEqual([
      "/usr/bin/bun",
      "/repo/src/cli.ts",
      "mcp-server",
      "--workspace",
      "ws",
    ]);
  });

  it("omits Bun's virtual /$bunfs/ entrypoint for compiled binaries", () => {
    expect(buildDaemonCommand("ws", "/usr/local/bin/grove", "/$bunfs/root/grove")).toEqual([
      "/usr/local/bin/grove",
      "mcp-server",
      "--workspace",
      "ws",
    ]);
  });

  it("omits Windows virtual ~BUN entrypoint and missing argv[1]", () => {
    expect(buildDaemonCommand("ws", "C:\\bin\\grove.exe", "B:/~BUN/root/grove.exe")).toEqual([
      "C:\\bin\\grove.exe",
      "mcp-server",
      "--workspace",
      "ws",
    ]);
    expect(buildDaemonCommand("ws", "/usr/local/bin/grove", null)).toEqual([
      "/usr/local/bin/grove",
      "mcp-server",
      "--workspace",
      "ws",
    ]);
  });
});

describe("grove mcp connect (stdio bridge)", () => {
  let tempDir: string;
  let fixtureRoot: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    fixtureRoot = join(tempDir, "workspaces");
    paths = createPaths(fixtureRoot);
    await addWorkspace("ws", paths);
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);
  });

  afterEach(async () => {
    // Kill the auto-started daemon so it doesn't leak past the test.
    try {
      const raw = await readFile(paths.daemonConfig("ws"), "utf8");
      const { pid } = JSON.parse(raw) as { pid: number };
      if (typeof pid === "number") {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    } catch {
      // no discovery file — nothing to kill
    }
    await cleanup(tempDir);
  });

  it("bridges initialize and tools/list, auto-starting the daemon", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: "bun",
      args: [CLI_PATH, "mcp", "connect", "--workspace", "ws"],
      env: { ...(process.env as Record<string, string>), GROVE_ROOT: fixtureRoot },
    });

    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("context_touch");
    } finally {
      await client.close();
    }

    // Daemon was auto-started: discovery file exists and health-checks OK.
    expect(await exists(paths.daemonConfig("ws"))).toBe(true);
  }, 30_000);

  it("auto-starts the daemon when invoked via the compiled bin/grove binary", async () => {
    expect(await exists(COMPILED_BIN)).toBe(true);
    const client = new Client({ name: "test-compiled", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: COMPILED_BIN,
      args: ["mcp", "connect", "--workspace", "ws"],
      env: { ...(process.env as Record<string, string>), GROVE_ROOT: fixtureRoot },
    });

    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("context_touch");
    } finally {
      await client.close();
    }

    expect(await exists(paths.daemonConfig("ws"))).toBe(true);
  }, 30_000);

  it("bridge process exits when its stdin closes (harness gone)", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "mcp", "connect", "--workspace", "ws"], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...(process.env as Record<string, string>), GROVE_ROOT: fixtureRoot },
    });

    // Wait for the auto-started daemon to come up — proves the bridge cleared
    // ensureDaemon and is now pumping stdio (stdin flowing).
    for (let i = 0; i < 150; i++) {
      if (await exists(paths.daemonConfig("ws"))) {
        break;
      }
      await Bun.sleep(100);
    }
    expect(await exists(paths.daemonConfig("ws"))).toBe(true);
    await Bun.sleep(500);

    // Simulate an ungraceful harness death: the bridge's stdin goes away.
    proc.stdin.end();

    const outcome = await Promise.race([
      proc.exited,
      Bun.sleep(10_000).then(() => "timeout" as const),
    ]);
    if (outcome === "timeout") {
      proc.kill();
    }
    expect(outcome).toBe(0);
  }, 30_000);

  it("daemon releases the bridge's session after the bridge's stdin closes", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "mcp", "connect", "--workspace", "ws"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...(process.env as Record<string, string>), GROVE_ROOT: fixtureRoot },
    });

    // Wait for the auto-started daemon, then read its URL for /health polling.
    for (let i = 0; i < 150; i++) {
      if (await exists(paths.daemonConfig("ws"))) {
        break;
      }
      await Bun.sleep(100);
    }
    expect(await exists(paths.daemonConfig("ws"))).toBe(true);
    await Bun.sleep(500); // let the bridge finish wiring stdio (stdin flowing)
    const { url } = JSON.parse(await readFile(paths.daemonConfig("ws"), "utf8")) as {
      url: string;
    };
    const healthUrl = url.replace("/mcp", "/health");

    async function daemonSessions(): Promise<number | null> {
      try {
        const body = (await fetch(healthUrl).then((r) => r.json())) as { sessions: number };
        return body.sessions;
      } catch {
        return null;
      }
    }

    // Drive an MCP initialize through the bridge so the daemon opens a session.
    const initialize = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "regression", version: "0.0.0" },
      },
    })}\n`;
    proc.stdin.write(initialize);
    await proc.stdin.flush();

    // Confirm the daemon actually registered the session.
    let opened = 0;
    for (let i = 0; i < 100; i++) {
      const n = await daemonSessions();
      if (n !== null && n >= 1) {
        opened = n;
        break;
      }
      await Bun.sleep(100);
    }
    expect(opened).toBeGreaterThanOrEqual(1);

    // Harness dies: the bridge's stdin closes. The daemon must release the
    // session (→ 0) so its grace timer can start and it can shut down.
    proc.stdin.end();

    let released = -1;
    for (let i = 0; i < 120; i++) {
      const n = await daemonSessions();
      if (n !== null) {
        released = n;
        if (released === 0) {
          break;
        }
      }
      await Bun.sleep(100);
    }
    expect(released).toBe(0);

    await Promise.race([proc.exited, Bun.sleep(5000)]);
    proc.kill();
  }, 40_000);
});
