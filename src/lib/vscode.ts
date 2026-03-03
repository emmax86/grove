import { writeFile } from "node:fs/promises";

import type { Paths } from "../constants";
import { err, ok, type Result } from "../types";
import { readConfig } from "./config";

export async function generateVSCodeWorkspace(
  workspace: string,
  paths: Paths,
): Promise<Result<void>> {
  const configResult = await readConfig(paths.workspaceConfig(workspace));
  if (!configResult.ok) {
    if (configResult.code === "CONFIG_NOT_FOUND") {
      return err(`Workspace "${workspace}" not found`, "WORKSPACE_NOT_FOUND");
    }
    return configResult;
  }

  const { repos } = configResult.value;

  const folders = [
    { path: ".", name: `${workspace} (workspace)` },
    ...repos
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ path: `trees/${r.name}`, name: r.name })),
  ];

  const obj = {
    folders,
    settings: {
      "files.exclude": { trees: true },
    },
  };

  try {
    await writeFile(paths.vscodeWorkspace(workspace), `${JSON.stringify(obj, null, 2)}\n`);
  } catch (e) {
    return err(String(e), "VSCODE_WORKSPACE_WRITE_FAILED");
  }

  return ok(undefined);
}
