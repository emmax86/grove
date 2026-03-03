import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPaths } from "../../constants";
import { writeConfig } from "../../lib/config";
import { generateVSCodeWorkspace } from "../../lib/vscode";
import { cleanup, createTestDir } from "../helpers";

describe("generateVSCodeWorkspace", () => {
  let tempDir: string;
  let paths: ReturnType<typeof createPaths>;

  beforeEach(async () => {
    tempDir = await createTestDir();
    paths = createPaths(join(tempDir, "workspaces"));
  });

  afterEach(() => cleanup(tempDir));

  async function setupWorkspace(ws: string, repos: { name: string; path: string }[] = []) {
    await mkdir(paths.workspace(ws), { recursive: true });
    await writeConfig(paths.workspaceConfig(ws), { name: ws, repos });
  }

  it("generates .code-workspace with root folder only for empty workspace", async () => {
    await setupWorkspace("alpha");
    const result = await generateVSCodeWorkspace("alpha", paths);
    expect(result.ok).toBe(true);

    const filePath = paths.vscodeWorkspace("alpha");
    const content = JSON.parse(await readFile(filePath, "utf-8"));
    expect(content.folders).toHaveLength(1);
    expect(content.folders[0].path).toBe(".");
    expect(content.folders[0].name).toBe("alpha (workspace)");
    expect(content.settings["files.exclude"].trees).toBe(true);
  });

  it("generates .code-workspace with repo folder entry", async () => {
    await setupWorkspace("alpha", [{ name: "myapp", path: "/some/path" }]);
    const result = await generateVSCodeWorkspace("alpha", paths);
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(paths.vscodeWorkspace("alpha"), "utf-8"));
    expect(content.folders).toHaveLength(2);
    expect(content.folders[0]).toEqual({
      path: ".",
      name: "alpha (workspace)",
    });
    expect(content.folders[1]).toEqual({ path: "trees/myapp", name: "myapp" });
  });

  it("sorts repo folders alphabetically", async () => {
    await setupWorkspace("alpha", [
      { name: "zebra", path: "/p" },
      { name: "apple", path: "/p" },
      { name: "mango", path: "/p" },
    ]);
    const result = await generateVSCodeWorkspace("alpha", paths);
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(paths.vscodeWorkspace("alpha"), "utf-8"));
    expect(content.folders[0].path).toBe(".");
    expect(content.folders[1].name).toBe("apple");
    expect(content.folders[2].name).toBe("mango");
    expect(content.folders[3].name).toBe("zebra");
  });

  it("overwrites existing .code-workspace on regeneration", async () => {
    await setupWorkspace("alpha");
    // Write a file with extra keys
    await writeFile(
      paths.vscodeWorkspace("alpha"),
      `${JSON.stringify({ folders: [], settings: {}, extraKey: "should-be-gone" }, null, 2)}\n`,
    );

    const result = await generateVSCodeWorkspace("alpha", paths);
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(paths.vscodeWorkspace("alpha"), "utf-8"));
    expect((content as Record<string, unknown>).extraKey).toBeUndefined();
    expect(content.folders).toHaveLength(1);
  });

  it("returns error for non-existent workspace", async () => {
    const result = await generateVSCodeWorkspace("ghost", paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORKSPACE_NOT_FOUND");
    }
  });
});
