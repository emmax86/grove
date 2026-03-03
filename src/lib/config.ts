import { readFile, writeFile } from "node:fs/promises";

import {
  err,
  ok,
  type RepoEntry,
  type Result,
  type WorkspaceConfig,
  type WorktreePool,
} from "../types";

export async function readConfig(configPath: string): Promise<Result<WorkspaceConfig>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return err(`Config file not found: ${configPath}`, "CONFIG_NOT_FOUND");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`Invalid JSON in config: ${configPath}`, "CONFIG_INVALID");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).name !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).repos)
  ) {
    return err("Invalid workspace.json schema", "CONFIG_INVALID");
  }

  return ok(parsed as WorkspaceConfig);
}

export async function writeConfig(
  configPath: string,
  config: WorkspaceConfig,
): Promise<Result<void>> {
  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return ok(undefined);
  } catch (e) {
    return err(String(e), "CONFIG_WRITE_FAILED");
  }
}

export async function addRepoToConfig(configPath: string, repo: RepoEntry): Promise<Result<void>> {
  const result = await readConfig(configPath);
  if (!result.ok) {
    return result;
  }

  const config = result.value;
  const existing = config.repos.findIndex((r) => r.name === repo.name);
  if (existing >= 0) {
    config.repos[existing] = repo;
  } else {
    config.repos.push(repo);
  }
  return writeConfig(configPath, config);
}

export async function removeRepoFromConfig(
  configPath: string,
  name: string,
): Promise<Result<void>> {
  const result = await readConfig(configPath);
  if (!result.ok) {
    return result;
  }

  const config = result.value;
  config.repos = config.repos.filter((r) => r.name !== name);
  return writeConfig(configPath, config);
}

export async function readPoolConfig(path: string): Promise<Result<WorktreePool>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return ok({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`Invalid JSON in pool config: ${path}`, "POOL_CONFIG_INVALID");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err("Invalid pool config schema", "POOL_CONFIG_INVALID");
  }

  return ok(parsed as WorktreePool);
}

export async function writePoolConfig(path: string, pool: WorktreePool): Promise<Result<void>> {
  try {
    await writeFile(path, `${JSON.stringify(pool, null, 2)}\n`);
    return ok(undefined);
  } catch (e) {
    return err(String(e), "POOL_CONFIG_WRITE_FAILED");
  }
}

export async function addPoolReference(
  path: string,
  repo: string,
  slug: string,
  workspace: string,
): Promise<Result<void>> {
  const result = await readPoolConfig(path);
  if (!result.ok) {
    return result;
  }

  const pool = result.value;
  if (!pool[repo]) {
    pool[repo] = {};
  }
  if (!pool[repo][slug]) {
    pool[repo][slug] = [];
  }
  if (!pool[repo][slug].includes(workspace)) {
    pool[repo][slug].push(workspace);
  }
  return writePoolConfig(path, pool);
}

export async function getPoolSlugsForWorkspace(
  path: string,
  repo: string,
  workspace: string,
): Promise<Result<string[]>> {
  const result = await readPoolConfig(path);
  if (!result.ok) {
    return result;
  }

  const pool = result.value;
  if (!pool[repo]) {
    return ok([]);
  }

  const slugs = Object.entries(pool[repo])
    .filter(([, workspaces]) => workspaces.includes(workspace))
    .map(([slug]) => slug);

  return ok(slugs);
}
