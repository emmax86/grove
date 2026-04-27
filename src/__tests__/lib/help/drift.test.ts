import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type HelpNode, REGISTRY } from "../../../lib/help/registry";

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

function extractReadmeCommands(readme: string): Set<string> {
  const tokens = new Set<string>();
  const lines = readme.split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) {
      continue;
    }
    const m = /\|\s*`([^`]+)`/.exec(line);
    if (!m) {
      continue;
    }
    const firstToken = m[1].trim().split(/\s+/)[0];
    tokens.add(firstToken);
  }
  return tokens;
}

describe("registry vs README drift", () => {
  it("every registry leaf appears in the README command tables", async () => {
    const readme = await readFile(README_PATH, "utf-8");
    const readmeCommands = extractReadmeCommands(readme);
    const missing: string[] = [];
    function walk(node: HelpNode, parentName?: string): void {
      if (node.kind === "group") {
        for (const child of node.children) {
          walk(child, node.name);
        }
      } else {
        if (!readmeCommands.has(node.name)) {
          missing.push(parentName ? `${parentName} ${node.name}` : node.name);
        }
      }
    }
    walk(REGISTRY);
    expect(missing, `registry leaves missing from README: ${missing.join(", ")}`).toEqual([]);
  });
});
