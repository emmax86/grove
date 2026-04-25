import { describe, expect, it } from "bun:test";

import { execDryRunPorcelain, execDryRunText } from "../../../../lib/render/formatters/exec";

const baseCtx = { colorEnabled: false, unicodeEnabled: true, isTTY: false, isStderrTTY: false };

describe("execDryRun", () => {
  const v = { repo: "grove", cwd: "/home/emma/projects/grove", command: ["bun", "test"] };

  it("text: would-run with cwd and repo", () => {
    expect(execDryRunText(v, baseCtx)).toBe(
      "would run: bun test\n  in: /home/emma/projects/grove\n  for: grove",
    );
  });

  it("porcelain: tab-separated", () => {
    expect(execDryRunPorcelain(v)).toBe("grove\t/home/emma/projects/grove\tbun test");
  });
});
