import { describe, expect, it } from "bun:test";

import { chars, computeUnicodeEnabled } from "../../../lib/render/ascii";

describe("computeUnicodeEnabled", () => {
  const base = { argv: [] as string[], env: {} as Record<string, string> };

  it("returns false when --ascii flag is set", () => {
    expect(computeUnicodeEnabled({ ...base, argv: ["--ascii"] })).toBe(false);
  });

  it("returns false when LANG=C", () => {
    expect(computeUnicodeEnabled({ ...base, env: { LANG: "C" } })).toBe(false);
  });

  it("returns false when LC_ALL=C", () => {
    expect(computeUnicodeEnabled({ ...base, env: { LC_ALL: "C" } })).toBe(false);
  });

  it("returns false when LC_CTYPE=C", () => {
    expect(computeUnicodeEnabled({ ...base, env: { LC_CTYPE: "C" } })).toBe(false);
  });

  it("returns false when TERM=dumb", () => {
    expect(computeUnicodeEnabled({ ...base, env: { TERM: "dumb" } })).toBe(false);
  });

  it("returns true with UTF-8 LANG and normal TERM", () => {
    expect(
      computeUnicodeEnabled({
        ...base,
        env: { LANG: "en_US.UTF-8", TERM: "xterm-256color" },
      }),
    ).toBe(true);
  });

  it("returns true with no env at all (default case)", () => {
    expect(computeUnicodeEnabled(base)).toBe(true);
  });
});

describe("chars", () => {
  it("provides unicode forms", () => {
    expect(chars(true).branch).toBe("├──");
    expect(chars(true).lastBranch).toBe("└──");
    expect(chars(true).vertical).toBe("│");
    expect(chars(true).arrow).toBe("→");
  });

  it("provides ASCII fallback forms", () => {
    expect(chars(false).branch).toBe("+--");
    expect(chars(false).lastBranch).toBe("`--");
    expect(chars(false).vertical).toBe("|");
    expect(chars(false).arrow).toBe("->");
  });
});
