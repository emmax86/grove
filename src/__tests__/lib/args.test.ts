import { describe, expect, it } from "bun:test";

import { parseArgs } from "../../lib/args";
import type { HelpGroup } from "../../lib/help/registry";

const fixture: HelpGroup = {
  kind: "group",
  name: "root",
  summary: "root",
  children: [
    {
      kind: "leaf",
      name: "cmd",
      summary: "cmd",
      flags: [
        { name: "custom", valueLabel: "<value>", summary: "fixture-only value flag" },
        { name: "toggle", summary: "fixture-only boolean flag" },
      ],
    },
  ],
};

describe("parseArgs", () => {
  it("consumes value-taking flags from the supplied help registry", () => {
    const parsed = parseArgs(["--custom", "VALUE", "cmd"], fixture);

    expect(parsed.flags.get("custom")).toBe("VALUE");
    expect(parsed.positional).toEqual(["cmd"]);
  });

  it("does not consume the next token for boolean flags", () => {
    const parsed = parseArgs(["--toggle", "cmd"], fixture);

    expect(parsed.flags.get("toggle")).toBe(true);
    expect(parsed.positional).toEqual(["cmd"]);
  });
});
