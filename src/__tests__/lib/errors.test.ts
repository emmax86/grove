import { describe, expect, it } from "bun:test";

import { ERROR_CATALOG } from "../../lib/errors";

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
