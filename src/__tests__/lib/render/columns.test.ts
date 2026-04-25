import { describe, expect, it } from "bun:test";

import { alignTable } from "../../../lib/render/columns";

describe("alignTable", () => {
  it("renders rows with two-space gap by default", () => {
    const out = alignTable([
      ["a", "long-path", "ok"],
      ["bb", "x", "dangling"],
    ]);
    expect(out).toBe("a   long-path  ok\nbb  x          dangling");
  });

  it("includes header row when provided", () => {
    const out = alignTable([["grove", "/home/x", "ok"]], { headers: ["NAME", "PATH", "STATUS"] });
    expect(out).toBe("NAME   PATH     STATUS\ngrove  /home/x  ok");
  });

  it("respects custom gap", () => {
    const out = alignTable([["a", "b"]], { gap: 4 });
    expect(out).toBe("a    b");
  });

  it("returns empty string for empty rows", () => {
    expect(alignTable([])).toBe("");
  });

  it("handles single-column rows", () => {
    expect(alignTable([["a"], ["bb"], ["c"]])).toBe("a\nbb\nc");
  });

  it("does not pad the last column", () => {
    const out = alignTable([
      ["short", "x"],
      ["longer", "y"],
    ]);
    expect(out).toBe("short   x\nlonger  y");
  });
});
