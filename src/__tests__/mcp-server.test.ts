import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { addRepo } from "../commands/repo";
import { addWorkspace } from "../commands/workspace";
import { createPaths } from "../constants";
import { createMcpServer } from "../mcp-server";
import { cleanup, createTestDir, createTestGitRepo, GIT_ENV } from "./helpers";

describe("MCP server", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  async function setupWorkspaceWithRepo() {
    await addWorkspace("ws", paths);
    const repoPath = await createTestGitRepo(tempDir, "myrepo");
    await addRepo("ws", repoPath, undefined, paths, GIT_ENV);
    return repoPath;
  }

  async function connectClient(workspace: string) {
    const server = createMcpServer(workspace, paths);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  // ── resource listing ────────────────────────────────────────────

  describe("resources", () => {
    it("lists 4 resources", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const { resources } = await client.listResources();
      expect(resources).toHaveLength(4);

      await client.close();
      await server.close();
    });

    it("lists resources with expected URIs", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);

      expect(uris).toContain("grove://workspace/status");
      expect(uris).toContain("grove://workspace/repos");
      expect(uris).toContain("grove://workspace/worktrees");
      expect(uris).toContain("grove://workspace/context");

      await client.close();
      await server.close();
    });

    it("status resource returns workspace name and counts", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.readResource({
        uri: "grove://workspace/status",
      });
      expect(result.contents).toHaveLength(1);
      const text = (result.contents[0] as { uri: string; text: string }).text;
      const data = JSON.parse(text);

      expect(data.name).toBe("ws");
      expect(typeof data.repoCount).toBe("number");
      expect(typeof data.worktreeCount).toBe("number");

      await client.close();
      await server.close();
    });

    it("repos resource returns registered repos", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.readResource({
        uri: "grove://workspace/repos",
      });
      const text = (result.contents[0] as { uri: string; text: string }).text;
      const data = JSON.parse(text);

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("myrepo");

      await client.close();
      await server.close();
    });

    it("repos resource returns empty array for workspace with no repos", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const result = await client.readResource({
        uri: "grove://workspace/repos",
      });
      const text = (result.contents[0] as { uri: string; text: string }).text;
      const data = JSON.parse(text);

      expect(data).toEqual([]);

      await client.close();
      await server.close();
    });

    it("worktrees resource returns worktrees list", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.readResource({
        uri: "grove://workspace/worktrees",
      });
      const text = (result.contents[0] as { uri: string; text: string }).text;
      const data = JSON.parse(text);

      expect(Array.isArray(data)).toBe(true);

      await client.close();
      await server.close();
    });

    it("context resource returns structured workspace context", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.readResource({
        uri: "grove://workspace/context",
      });
      const text = (result.contents[0] as { uri: string; text: string }).text;
      const data = JSON.parse(text);

      expect(data.name).toBe("ws");
      expect(Array.isArray(data.repos)).toBe(true);

      await client.close();
      await server.close();
    });
  });

  // ── tool listing ────────────────────────────────────────────────

  describe("tools", () => {
    it("lists 6 tools", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);

      await client.close();
      await server.close();
    });

    it("lists tools with expected names", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain("workspace_status");
      expect(names).toContain("workspace_add_worktree");
      expect(names).toContain("workspace_remove_worktree");
      expect(names).toContain("workspace_sync");
      expect(names).toContain("workspace_path");
      expect(names).toContain("workspace_exec");

      await client.close();
      await server.close();
    });

    it("workspace_status returns workspace state", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_status",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      const data = JSON.parse(text);

      expect(data.name).toBe("ws");
      expect(Array.isArray(data.repos)).toBe(true);

      await client.close();
      await server.close();
    });

    it("workspace_path returns workspace path", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_path",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      const data = JSON.parse(text);

      expect(data.path).toBe(paths.workspace("ws"));

      await client.close();
      await server.close();
    });

    it("workspace_sync returns sync result", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_sync",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      const data = JSON.parse(text);

      expect(Array.isArray(data.repos)).toBe(true);
      expect(Array.isArray(data.pruned)).toBe(true);

      await client.close();
      await server.close();
    });

    it("workspace_add_worktree creates a worktree", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_add_worktree",
        arguments: { repo: "myrepo", branch: "feature-x", newBranch: true },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      const data = JSON.parse(text);

      expect(data.repo).toBe("myrepo");
      expect(data.branch).toBe("feature-x");

      await client.close();
      await server.close();
    });

    it("workspace_remove_worktree removes a worktree", async () => {
      await setupWorkspaceWithRepo();
      const { client, server } = await connectClient("ws");

      // Add a worktree first
      await client.callTool({
        name: "workspace_add_worktree",
        arguments: { repo: "myrepo", branch: "to-remove", newBranch: true },
      });

      const result = await client.callTool({
        name: "workspace_remove_worktree",
        arguments: { repo: "myrepo", slug: "to-remove" },
      });
      expect(result.isError).toBeFalsy();

      await client.close();
      await server.close();
    });

    it("workspace_add_worktree returns error for unknown repo", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_add_worktree",
        arguments: { repo: "ghost", branch: "feature-x", newBranch: true },
      });
      expect(result.isError).toBe(true);

      await client.close();
      await server.close();
    });

    it("workspace_remove_worktree returns error for unknown worktree", async () => {
      await addWorkspace("ws", paths);
      const { client, server } = await connectClient("ws");

      const result = await client.callTool({
        name: "workspace_remove_worktree",
        arguments: { repo: "ghost", slug: "nope" },
      });
      expect(result.isError).toBe(true);

      await client.close();
      await server.close();
    });
  });
});
