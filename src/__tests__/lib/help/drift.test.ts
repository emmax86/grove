import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type HelpGroup, type HelpNode, REGISTRY } from "../../../lib/help/registry";

const CLI_PATH = join(import.meta.dir, "../../../cli.ts");

/**
 * Extract full case-stack paths from TypeScript source.
 *
 * Walks `case "X":`, `{`, `}` tokens with a brace-depth counter. Each `case`
 * pushes onto a stack at the current depth; sibling cases (same depth) replace
 * the previous; closing braces pop cases entered deeper than the new depth.
 * The emitted path is the joined case stack, so a `case "add":` nested inside
 * `case "repo":` produces `"repo add"` rather than `"add"`.
 *
 * Does not parse strings or comments — relies on cli.ts not containing literal
 * `case "..."`-shaped text outside actual case statements.
 */
function extractDispatchPaths(source: string): Set<string> {
  const paths = new Set<string>();
  const stack: { name: string; depthEntered: number }[] = [];
  let depth = 0;
  const re = /case\s+"([^"]+)":|[{}]/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    const tok = m[0];
    if (tok === "{") {
      depth++;
    } else if (tok === "}") {
      depth--;
      while (stack.length > 0 && stack[stack.length - 1].depthEntered > depth) {
        stack.pop();
      }
    } else {
      const name = m[1];
      while (stack.length > 0 && stack[stack.length - 1].depthEntered >= depth) {
        stack.pop();
      }
      stack.push({ name, depthEntered: depth });
      paths.add(stack.map((s) => s.name).join(" "));
    }
    m = re.exec(source);
  }
  return paths;
}

/**
 * Build the set of dispatch full paths reachable from cli.ts.
 *
 * Combines case-stack paths (prefixed with `ws ` since they live inside the ws
 * subcmd switch), top-level `cmd === "X"` checks (mcp-server, ws), and
 * `argv[N] === "X"` inline guards (e.g. `ws exec`, prefixed with `ws `).
 */
function buildReachablePaths(source: string): Set<string> {
  const out = new Set<string>();
  for (const p of extractDispatchPaths(source)) {
    out.add(`ws ${p}`);
  }
  const reCmd = /cmd === "([^"]+)"/g;
  let m: RegExpExecArray | null = reCmd.exec(source);
  while (m !== null) {
    out.add(m[1]);
    m = reCmd.exec(source);
  }
  const reArgv = /argv\[\d+\] === "([^"]+)"/g;
  m = reArgv.exec(source);
  while (m !== null) {
    out.add(`ws ${m[1]}`);
    m = reArgv.exec(source);
  }
  return out;
}

function registryFullPaths(node: HelpNode = REGISTRY, parents: readonly string[] = []): string[] {
  const paths: string[] = [];
  if (parents.length > 0) {
    // node.name without the registry's "grove" root
    paths.push([...parents.slice(1), node.name].join(" "));
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      paths.push(...registryFullPaths(child, [...parents, node.name]));
    }
  }
  return paths;
}

describe("extractDispatchPaths", () => {
  it("returns flat case names at the top level of a switch", () => {
    const src = `switch (x) { case "a": {} case "b": {} }`;
    const paths = extractDispatchPaths(src);
    expect(paths.has("a")).toBe(true);
    expect(paths.has("b")).toBe(true);
  });

  it("returns nested case paths separated by space", () => {
    const src = `
      switch (x) {
        case "outer": {
          switch (y) {
            case "inner": {}
          }
        }
      }
    `;
    const paths = extractDispatchPaths(src);
    expect(paths.has("outer")).toBe(true);
    expect(paths.has("outer inner")).toBe(true);
    expect(paths.has("inner")).toBe(false);
  });

  it("distinguishes same-named cases under different parents", () => {
    const src = `
      switch (x) {
        case "a": { switch (y) { case "x": {} } }
        case "b": { switch (z) { case "x": {} } }
      }
    `;
    const paths = extractDispatchPaths(src);
    expect(paths.has("a x")).toBe(true);
    expect(paths.has("b x")).toBe(true);
    // bare "x" must not appear because it's only ever nested under a or b
    expect(paths.has("x")).toBe(false);
  });
});

describe("registry vs dispatch drift", () => {
  let reachable: Set<string>;

  beforeAll(async () => {
    const source = await readFile(CLI_PATH, "utf-8");
    reachable = buildReachablePaths(source);
  });

  it("every registry full path is reachable through dispatch", () => {
    const missing: string[] = [];
    for (const path of registryFullPaths()) {
      if (!reachable.has(path)) {
        missing.push(path);
      }
    }
    expect(missing, `registry paths not reached by dispatch: ${missing.join(", ")}`).toEqual([]);
  });

  it("every dispatch path has a registry node (excluding aliases and exec arg values)", () => {
    // Aliases (e.g. "workspaces" === "ws") and exec arg values are not registry leaves.
    const registryPathSet = new Set(registryFullPaths());
    registryPathSet.add("workspaces");
    const execArgValues = new Set(["setup", "format", "test", "check", "test:file", "test:match"]);
    const extras: string[] = [];
    for (const p of reachable) {
      if (registryPathSet.has(p)) {
        continue;
      }
      const lastToken = p.split(" ").at(-1);
      if (lastToken !== undefined && execArgValues.has(lastToken)) {
        continue;
      }
      extras.push(p);
    }
    expect(extras, `dispatch paths missing from registry: ${extras.join(", ")}`).toEqual([]);
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
