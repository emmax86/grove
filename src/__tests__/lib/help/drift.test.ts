import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type HelpGroup, type HelpNode, REGISTRY } from "../../../lib/help/registry";

const CLI_PATH = join(import.meta.dir, "../../../cli.ts");

function extractDispatchCases(source: string): string[] {
  const out: string[] = [];
  const re = /case\s+"([^"]+)":/g;
  let m = re.exec(source);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(source);
  }
  return out;
}

function extractRegistryTokens(node: HelpNode = REGISTRY): Set<string> {
  const set = new Set<string>();
  if (node.kind === "group") {
    for (const child of node.children) {
      set.add(child.name);
      for (const alias of child.aliases ?? []) {
        set.add(alias);
      }
      for (const tok of extractRegistryTokens(child)) {
        set.add(tok);
      }
    }
  }
  return set;
}

describe("registry vs dispatch drift", () => {
  let dispatchCases: Set<string>;
  let registryTokens: Set<string>;

  beforeAll(async () => {
    const source = await readFile(CLI_PATH, "utf-8");
    dispatchCases = new Set(extractDispatchCases(source));
    registryTokens = extractRegistryTokens();
  });

  it("every dispatch case has a registry node (excluding ws exec subcommand values)", () => {
    const missing: string[] = [];
    const execSubcommandValues = new Set([
      "setup",
      "format",
      "test",
      "check",
      "test:file",
      "test:match",
    ]);
    for (const c of dispatchCases) {
      if (execSubcommandValues.has(c)) {
        continue;
      }
      if (!registryTokens.has(c)) {
        missing.push(c);
      }
    }
    expect(missing, `dispatch cases missing from registry: ${missing.join(", ")}`).toEqual([]);
  });

  it("every registry leaf is reachable through dispatch", async () => {
    const source = await readFile(CLI_PATH, "utf-8");
    const reachable = new Set([...dispatchCases]);
    // Capture: cmd === "X" style top-level guards
    const reTopLevel = /cmd === "([^"]+)"/g;
    let m = reTopLevel.exec(source);
    while (m !== null) {
      reachable.add(m[1]);
      m = reTopLevel.exec(source);
    }
    // Capture: argv[N] === "X" style inline guards (e.g. ws exec)
    const reArgv = /argv\[\d+\] === "([^"]+)"/g;
    let m2 = reArgv.exec(source);
    while (m2 !== null) {
      reachable.add(m2[1]);
      m2 = reArgv.exec(source);
    }
    const missing: string[] = [];
    function walk(node: HelpNode): void {
      if (node.kind === "group") {
        for (const c of node.children) {
          walk(c);
        }
      } else {
        if (!reachable.has(node.name)) {
          missing.push(node.name);
        }
      }
    }
    walk(REGISTRY);
    expect(missing, `registry leaves not reached by dispatch: ${missing.join(", ")}`).toEqual([]);
  });
});

const README_PATH = join(import.meta.dir, "../../../../README.md");

function isLeafPath(registry: HelpGroup, path: readonly string[]): boolean {
  let node: HelpNode = registry;
  for (const tok of path) {
    if (node.kind !== "group") {
      return false;
    }
    const child: HelpNode | undefined = node.children.find(
      (c) => c.name === tok || (c.aliases?.includes(tok) ?? false),
    );
    if (!child) {
      return false;
    }
    node = child;
  }
  return node.kind === "leaf";
}

/**
 * Extract full command paths from README command tables.
 *
 * Tracks the current section heading (e.g., `### Repos — \`grove ws repo <command>\``)
 * and prefixes each row's first token with the heading's path tokens, so
 * `add` under "Repos" becomes `ws repo add` in the returned set.
 *
 * Rows under a heading whose prefix resolves to a registry **leaf** (e.g. `ws exec`)
 * are skipped — those tables list arg values, not subcommand leaves.
 */
function extractReadmeCommands(readme: string, registry: HelpGroup = REGISTRY): Set<string> {
  const out = new Set<string>();
  const lines = readme.split("\n");
  let prefix: readonly string[] = [];
  let prefixIsLeaf = false;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const m = /`grove\s+(.+?)\s+<command>`/.exec(line);
      if (m) {
        prefix = m[1].trim().split(/\s+/);
        prefixIsLeaf = isLeafPath(registry, prefix);
      } else {
        prefix = [];
        prefixIsLeaf = false;
      }
      continue;
    }
    if (!line.startsWith("|") || prefixIsLeaf) {
      continue;
    }
    const m = /\|\s*`([^`]+)`/.exec(line);
    if (!m) {
      continue;
    }
    const firstToken = m[1].trim().split(/\s+/)[0];
    const fullPath = prefix.length > 0 ? [...prefix, firstToken].join(" ") : firstToken;
    out.add(fullPath);
  }
  return out;
}

describe("extractReadmeCommands", () => {
  it("captures full paths under prefix headings, not just leaf names", () => {
    const readme = [
      "### Workspaces — `grove ws <command>`",
      "",
      "| Command | Description |",
      "| ------- | ----------- |",
      "| `add <name>` | Create a workspace |",
      "| `list` | List workspaces |",
      "",
      "### Repos — `grove ws repo <command>`",
      "",
      "| Command | Description |",
      "| ------- | ----------- |",
      "| `add [workspace] <path>` | Register a git repo |",
      "| `list [workspace]` | List registered repos |",
      "",
      "### Other",
      "",
      "| Command | Description |",
      "| ------- | ----------- |",
      "| `mcp-server [--workspace W]` | Start MCP server |",
      "",
    ].join("\n");
    const cmds = extractReadmeCommands(readme);
    expect(cmds.has("ws add")).toBe(true);
    expect(cmds.has("ws list")).toBe(true);
    expect(cmds.has("ws repo add")).toBe(true);
    expect(cmds.has("ws repo list")).toBe(true);
    expect(cmds.has("mcp-server")).toBe(true);
    // Bare leaf names without prefix must not satisfy nested-leaf paths
    expect(cmds.has("add")).toBe(false);
    expect(cmds.has("list")).toBe(false);
  });

  it("skips rows under a heading that maps to a registry leaf (e.g. ws exec)", () => {
    // ws exec's table lists arg values, not subcommand leaves.
    const readme = [
      "### Exec — `grove ws exec <command>`",
      "",
      "| Command | Description |",
      "| ------- | ----------- |",
      "| `setup` | Install dependencies |",
      "| `test` | Run the full test suite |",
      "",
    ].join("\n");
    const cmds = extractReadmeCommands(readme);
    expect(cmds.has("ws exec setup")).toBe(false);
    expect(cmds.has("ws exec test")).toBe(false);
  });
});

describe("registry vs README drift", () => {
  it("every registry leaf appears in the README command tables (full path)", async () => {
    const readme = await readFile(README_PATH, "utf-8");
    const readmeCommands = extractReadmeCommands(readme);
    const missing: string[] = [];
    function walk(node: HelpNode, parents: readonly string[]): void {
      if (node.kind === "group") {
        for (const child of node.children) {
          walk(child, [...parents, node.name]);
        }
      } else {
        // parents = ["grove", "ws", "repo"], node.name = "add" -> "ws repo add"
        const fullPath = [...parents.slice(1), node.name].join(" ");
        if (!readmeCommands.has(fullPath)) {
          missing.push(fullPath);
        }
      }
    }
    walk(REGISTRY, []);
    expect(missing, `registry leaves missing from README: ${missing.join(", ")}`).toEqual([]);
  });
});
