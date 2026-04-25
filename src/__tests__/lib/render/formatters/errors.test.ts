import { describe, expect, it } from "bun:test";

import { stripAnsi } from "../../../../lib/render/color";
import { formatError } from "../../../../lib/render/formatters/errors";

describe("formatError", () => {
  it("renders two-line text with bold red error and dim red code (color on)", () => {
    const out = formatError("workspace 'foo' not found", "WORKSPACE_NOT_FOUND", {
      colorEnabled: true,
    });
    expect(out).toBe(
      "\x1b[1m\x1b[31merror:\x1b[39m\x1b[22m workspace 'foo' not found\n  \x1b[2m\x1b[31mcode:\x1b[39m\x1b[22m WORKSPACE_NOT_FOUND",
    );
  });

  it("renders plain two-line text when color is off", () => {
    const out = formatError("workspace 'foo' not found", "WORKSPACE_NOT_FOUND", {
      colorEnabled: false,
    });
    expect(out).toBe("error: workspace 'foo' not found\n  code: WORKSPACE_NOT_FOUND");
  });

  it("color-off output equals stripAnsi(color-on output)", () => {
    const colorOn = formatError("oops", "BAD", { colorEnabled: true });
    const colorOff = formatError("oops", "BAD", { colorEnabled: false });
    expect(stripAnsi(colorOn)).toBe(colorOff);
  });
});
