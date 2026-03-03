import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addPoolReference,
  addRepoToConfig,
  getPoolSlugsForWorkspace,
  readConfig,
  readPoolConfig,
  removeRepoFromConfig,
  writeConfig,
  writePoolConfig,
} from "../../lib/config";
import { cleanup, createTestDir } from "../helpers";

describe("config", () => {
  let tempDir: string;
  let wsDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    wsDir = join(tempDir, "myws");
    mkdirSync(wsDir, { recursive: true });
    configPath = join(wsDir, "workspace.json");
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("write then read roundtrip", async () => {
    const config = { name: "myws", repos: [] };
    await writeConfig(configPath, config);
    const result = await readConfig(configPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(config);
    }
  });

  it("read non-existent file returns error", async () => {
    const result = await readConfig(join(tempDir, "nonexistent", "workspace.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_NOT_FOUND");
    }
  });

  it("addRepoToConfig appends a repo", async () => {
    await writeConfig(configPath, { name: "myws", repos: [] });
    const result = await addRepoToConfig(configPath, {
      name: "mrepo",
      path: "/some/path",
    });
    expect(result.ok).toBe(true);
    const config = await readConfig(configPath);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.repos).toHaveLength(1);
      expect(config.value.repos[0].name).toBe("mrepo");
    }
  });

  it("addRepoToConfig deduplicates by name", async () => {
    await writeConfig(configPath, {
      name: "myws",
      repos: [{ name: "mrepo", path: "/old" }],
    });
    await addRepoToConfig(configPath, { name: "mrepo", path: "/new" });
    const config = await readConfig(configPath);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.repos).toHaveLength(1);
      expect(config.value.repos[0].path).toBe("/new");
    }
  });

  it("removeRepoFromConfig removes a repo", async () => {
    await writeConfig(configPath, {
      name: "myws",
      repos: [{ name: "mrepo", path: "/p" }],
    });
    const result = await removeRepoFromConfig(configPath, "mrepo");
    expect(result.ok).toBe(true);
    const config = await readConfig(configPath);
    if (config.ok) {
      expect(config.value.repos).toHaveLength(0);
    }
  });

  it("removeRepoFromConfig handles missing repo gracefully", async () => {
    await writeConfig(configPath, { name: "myws", repos: [] });
    const result = await removeRepoFromConfig(configPath, "nonexistent");
    expect(result.ok).toBe(true);
  });

  it("invalid JSON returns error", async () => {
    writeFileSync(configPath, "not json");
    const result = await readConfig(configPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_INVALID");
    }
  });

  it("valid JSON but wrong schema returns error", async () => {
    writeFileSync(configPath, JSON.stringify({ wrong: "schema" }));
    const result = await readConfig(configPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_INVALID");
    }
  });

  it("writeConfig returns error when path is not writable", async () => {
    // Write to a path inside a non-writable directory
    const roDir = join(tempDir, "readonly");
    mkdirSync(roDir);
    chmodSync(roDir, 0o444);
    const roConfig = join(roDir, "workspace.json");
    const result = await writeConfig(roConfig, { name: "test", repos: [] });
    chmodSync(roDir, 0o755); // restore so cleanup works
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_WRITE_FAILED");
    }
  });

  it("addRepoToConfig propagates writeConfig failure", async () => {
    await writeConfig(configPath, { name: "myws", repos: [] });
    // Make the directory read-only so write fails
    chmodSync(wsDir, 0o444);
    const result = await addRepoToConfig(configPath, { name: "r", path: "/p" });
    chmodSync(wsDir, 0o755);
    expect(result.ok).toBe(false);
  });

  it("removeRepoFromConfig propagates writeConfig failure", async () => {
    await writeConfig(configPath, {
      name: "myws",
      repos: [{ name: "r", path: "/p" }],
    });
    chmodSync(wsDir, 0o444);
    const result = await removeRepoFromConfig(configPath, "r");
    chmodSync(wsDir, 0o755);
    expect(result.ok).toBe(false);
  });
});

describe("pool config", () => {
  let tempDir: string;
  let poolConfigPath: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    poolConfigPath = join(tempDir, "worktrees.json");
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("readPoolConfig returns {} when file doesn't exist", async () => {
    const result = await readPoolConfig(poolConfigPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("readPoolConfig returns error on invalid JSON", async () => {
    writeFileSync(poolConfigPath, "not json");
    const result = await readPoolConfig(poolConfigPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POOL_CONFIG_INVALID");
    }
  });

  it("writePoolConfig then readPoolConfig roundtrip", async () => {
    const pool = { myrepo: { "feature-x": ["ws1", "ws2"] } };
    await writePoolConfig(poolConfigPath, pool);
    const result = await readPoolConfig(poolConfigPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(pool);
    }
  });

  it("addPoolReference creates nested structure", async () => {
    const result = await addPoolReference(poolConfigPath, "myrepo", "feature-x", "ws1");
    expect(result.ok).toBe(true);
    const pool = await readPoolConfig(poolConfigPath);
    expect(pool.ok).toBe(true);
    if (pool.ok) {
      expect(pool.value.myrepo["feature-x"]).toEqual(["ws1"]);
    }
  });

  it("addPoolReference is idempotent (no duplicate ws entries)", async () => {
    await addPoolReference(poolConfigPath, "myrepo", "feature-x", "ws1");
    await addPoolReference(poolConfigPath, "myrepo", "feature-x", "ws1");
    const pool = await readPoolConfig(poolConfigPath);
    if (pool.ok) {
      expect(pool.value.myrepo["feature-x"]).toEqual(["ws1"]);
    }
  });

  it("addPoolReference adds multiple workspaces", async () => {
    await addPoolReference(poolConfigPath, "myrepo", "feature-x", "ws1");
    await addPoolReference(poolConfigPath, "myrepo", "feature-x", "ws2");
    const pool = await readPoolConfig(poolConfigPath);
    if (pool.ok) {
      expect(pool.value.myrepo["feature-x"]).toContain("ws1");
      expect(pool.value.myrepo["feature-x"]).toContain("ws2");
    }
  });

  it("getPoolSlugsForWorkspace filters by workspace", async () => {
    await addPoolReference(poolConfigPath, "myrepo", "feature-a", "ws1");
    await addPoolReference(poolConfigPath, "myrepo", "feature-b", "ws1");
    await addPoolReference(poolConfigPath, "myrepo", "feature-c", "ws2");
    const result = await getPoolSlugsForWorkspace(poolConfigPath, "myrepo", "ws1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("feature-a");
      expect(result.value).toContain("feature-b");
      expect(result.value).not.toContain("feature-c");
    }
  });

  it("getPoolSlugsForWorkspace returns empty array for unknown repo/workspace", async () => {
    const result = await getPoolSlugsForWorkspace(poolConfigPath, "unknown-repo", "ws1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("readPoolConfig with valid JSON but array schema returns error", async () => {
    writeFileSync(poolConfigPath, JSON.stringify([1, 2, 3]));
    const result = await readPoolConfig(poolConfigPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POOL_CONFIG_INVALID");
    }
  });

  it("writePoolConfig returns error when path is not writable", async () => {
    const roDir = join(tempDir, "readonly");
    mkdirSync(roDir);
    chmodSync(roDir, 0o444);
    const roPool = join(roDir, "worktrees.json");
    const result = await writePoolConfig(roPool, {});
    chmodSync(roDir, 0o755);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POOL_CONFIG_WRITE_FAILED");
    }
  });
});
