import { describe, expect, it } from "bun:test";

import { ERROR_CATALOG, mapFsError } from "../../lib/errors";

describe("ERROR_CATALOG", () => {
  it("has unique codes (object keys are inherently unique, but verify the type matches)", () => {
    const codes = Object.keys(ERROR_CATALOG);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has a non-empty description for every entry", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.description, `${code} description`).toBeTruthy();
      expect(entry.description.length, `${code} description length`).toBeGreaterThan(0);
    }
  });
});

describe("mapFsError", () => {
  it("translates ENOENT to FILE_NOT_FOUND", () => {
    const result = mapFsError({ code: "ENOENT", message: "no such file" }, "CONFIG_WRITE_FAILED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FILE_NOT_FOUND");
      expect(result.error).toBe("no such file");
    }
  });

  it("uses the fallback code for non-ENOENT errors", () => {
    const result = mapFsError(new Error("disk full"), "CONFIG_WRITE_FAILED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG_WRITE_FAILED");
      expect(result.error).toContain("disk full");
    }
  });
});
