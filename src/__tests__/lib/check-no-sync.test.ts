import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { findSyncCalls, scanSyncViolations } from "../../../scripts/check-no-sync";
import { cleanup, createTestDir } from "../helpers";

describe("check-no-sync", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await cleanup(tempDir);
      tempDir = undefined;
    }
  });

  it("reports direct and property call expressions whose callee ends with Sync", () => {
    const violations = findSyncCalls(
      "example.ts",
      `
        readFileSync("file.txt");
        fs.realpathSync(".");
        customSync();
      `,
    );

    expect(violations).toEqual([
      { line: 2, name: "readFileSync" },
      { line: 3, name: "realpathSync" },
      { line: 4, name: "customSync" },
    ]);
  });

  it("ignores Sync text in comments, strings, and declarations", () => {
    const violations = findSyncCalls(
      "example.ts",
      `
        // readFileSync("file.txt");
        const text = "fs.realpathSync('.')"; 
        function readFileSync() {
          return "not a call";
        }
        const customSync = true;
      `,
    );

    expect(violations).toEqual([]);
  });

  it("scans TypeScript files recursively and reports repository-relative paths", async () => {
    tempDir = await createTestDir();
    const src = join(tempDir, "src");
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "ok.ts"), "const text = 'readFileSync()';\n");
    await writeFile(join(src, "nested", "bad.ts"), "fs.realpathSync('.');\n");
    await writeFile(join(src, "ignored.js"), "fs.readFileSync('x');\n");

    const violations = await scanSyncViolations(tempDir);

    expect(violations).toEqual([
      {
        file: "src/nested/bad.ts",
        line: 1,
        name: "realpathSync",
      },
    ]);
  });
});
