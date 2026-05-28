/**
 * Enforces a "zero sync" invariant across all source files, including tests.
 *
 * Parses all TypeScript files under src/ using the TypeScript AST and fails
 * if any CallExpression whose callee name ends with "Sync" is found. This
 * correctly ignores comments, string literals, and multi-line call expressions.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

export type SyncCallViolation = { line: number; name: string };
export type SyncScanViolation = SyncCallViolation & { file: string };

export function findSyncCalls(filePath: string, content: string): SyncCallViolation[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const violations: SyncCallViolation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name: string | undefined;

      if (ts.isIdentifier(callee)) {
        name = callee.text;
      } else if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
      }

      if (name?.endsWith("Sync")) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({ line: line + 1, name });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

export async function scanSyncViolations(root = ROOT): Promise<SyncScanViolation[]> {
  const files = await collectFiles(join(root, "src"));
  const violations: SyncScanViolation[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    for (const { line, name } of findSyncCalls(file, content)) {
      violations.push({ file: relative(root, file), line, name });
    }
  }

  return violations;
}

if (import.meta.main) {
  const violations = await scanSyncViolations();

  for (const { file, line, name } of violations) {
    console.error(`${file}:${line}: ${name}(`);
  }

  if (violations.length > 0) {
    console.error(`\n${violations.length} sync violation(s) found.`);
    process.exit(1);
  }

  console.log("check-no-sync: ok");
}
