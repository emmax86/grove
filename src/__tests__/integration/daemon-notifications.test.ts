import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import { addRepo } from "../../commands/repo";
import { addWorkspace } from "../../commands/workspace";
import { createPaths } from "../../constants";
import { startDaemon } from "../../lib/daemon";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "../helpers";

describe("daemon push notifications", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;
  let daemonStop: () => Promise<void>;
  let mcpUrl: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
    await addWorkspace("ws", paths);
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);

    const daemon = await startDaemon({
      workspace: "ws",
      paths,
      gracePeriodMs: 1000,
    });
    mcpUrl = daemon.url;
    daemonStop = daemon.stop;
  });

  afterEach(async () => {
    await daemonStop();
    await cleanup(tempDir);
  });

  async function connectClient() {
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  /**
   * Sets a persistent notification handler on the client and returns a function
   * that resolves on the next resourceListChanged notification. Safe to call
   * multiple times concurrently — each call enqueues its own resolver.
   */
  function makeNotificationWaiter(client: Client): () => Promise<void> {
    const pending: Array<() => void> = [];
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      pending.shift()?.();
    });
    return () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for resourceListChanged notification")),
          2000,
        );
        pending.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
  }

  it("broadcasts resourceListChanged to all sessions after workspace_add_worktree", async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();
    const wait1 = makeNotificationWaiter(client1);
    const wait2 = makeNotificationWaiter(client2);

    // Enqueue waits before triggering the mutation
    const notif1 = wait1();
    const notif2 = wait2();

    const result = await client1.callTool({
      name: "workspace_add_worktree",
      arguments: {
        repo: "myrepo",
        branch: "notify-integration",
        newBranch: true,
      },
    });
    expect(result.isError).toBeFalsy();

    await Promise.all([notif1, notif2]);

    await client1.close();
    await client2.close();
  });

  it("broadcasts resourceListChanged after workspace_remove_worktree", async () => {
    const client = await connectClient();
    const waitForNotification = makeNotificationWaiter(client);

    // Enqueue waits before triggering mutations — notification may arrive
    // before callTool resolves since onStateChange runs server-side first
    const addNotif = waitForNotification();
    await client.callTool({
      name: "workspace_add_worktree",
      arguments: { repo: "myrepo", branch: "to-remove", newBranch: true },
    });
    await addNotif;

    const removeNotif = waitForNotification();
    const result = await client.callTool({
      name: "workspace_remove_worktree",
      arguments: { repo: "myrepo", slug: "to-remove" },
    });
    expect(result.isError).toBeFalsy();

    await removeNotif;

    await client.close();
  });
});
