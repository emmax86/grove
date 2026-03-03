/**
 * Enforces a "zero sync in production" invariant.
 *
 * Scans all TypeScript files under src/ (excluding __tests__ directories)
 * and fails if any *Sync( call sites are found.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

// Matches any *Sync( call site — e.g. existsSync(, Bun.spawnSync(, realpathSync(
const SYNC_CALL = /\b\w+Sync\s*\(/g;

async function collectProductionFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectProductionFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = await collectProductionFiles(SRC);
let violations = 0;

for (const file of files) {
  const content = await readFile(file, "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comment lines
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
      continue;
    }
    const matches = line.match(SYNC_CALL);
    if (matches) {
      for (const match of matches) {
        console.error(`${relative(ROOT, file)}:${i + 1}: ${match}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} sync violation(s) found in production code.`);
  process.exit(1);
}

console.log("check-no-sync: ok");
