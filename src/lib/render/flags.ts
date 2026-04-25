import { err, ok, type Result } from "../../types";
import { computeUnicodeEnabled } from "./ascii";
import { computeColorEnabled } from "./color";
import type { RenderContext, RenderMode } from "./index";

export function resolveRenderContext(input: {
  argv: string[];
  env: Record<string, string | undefined>;
  isTTY: boolean; // stdout
  isStderrTTY: boolean; // stderr
}): Result<RenderContext> {
  const flags = {
    text: input.argv.includes("--text"),
    porcelain: input.argv.includes("--porcelain"),
    json: input.argv.includes("--json"),
  };
  const setCount = Number(flags.text) + Number(flags.porcelain) + Number(flags.json);
  if (setCount > 1) {
    return err("--text, --porcelain, and --json are mutually exclusive", "INVALID_FLAGS");
  }

  let mode: RenderMode = "text";
  if (flags.porcelain) {
    mode = "porcelain";
  } else if (flags.json) {
    mode = "json";
  }

  const colorEnabled = computeColorEnabled({
    argv: input.argv,
    env: input.env,
    isTTY: input.isTTY,
    mode,
  });
  const unicodeEnabled = computeUnicodeEnabled({ argv: input.argv, env: input.env });

  const warnings: string[] = [];
  if (mode !== "text") {
    if (input.argv.includes("--no-color")) {
      warnings.push("--no-color is ignored outside text mode");
    }
    if (input.argv.includes("--ascii")) {
      warnings.push("--ascii is ignored outside text mode");
    }
  }

  return ok({
    mode,
    colorEnabled,
    unicodeEnabled,
    isTTY: input.isTTY,
    isStderrTTY: input.isStderrTTY,
    warnings,
  });
}
