export interface ColorContext {
  argv: string[];
  env: Record<string, string | undefined>;
  isTTY: boolean;
  mode: "text" | "porcelain" | "json";
}

export function computeColorEnabled(ctx: ColorContext): boolean {
  if (ctx.argv.includes("--no-color")) {
    return false;
  }
  if (ctx.env.NO_COLOR && ctx.env.NO_COLOR.length > 0) {
    return false;
  }
  if (ctx.mode !== "text") {
    return false;
  }
  if (ctx.env.FORCE_COLOR && ctx.env.FORCE_COLOR.length > 0) {
    return true;
  }
  if (ctx.env.TERM === "dumb") {
    return false;
  }
  if (!ctx.isTTY) {
    return false;
  }
  return true;
}

const wrap = (open: string, close: string) => (s: string, enabled: boolean) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const c = {
  red: wrap("31", "39"),
  cyan: wrap("36", "39"),
  yellow: wrap("33", "39"),
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
};

// Named exports for use in formatters that prefer named imports over `c.*`.
export const bold = c.bold;
export const cyan = c.cyan;
export const dim = c.dim;
export const yellow = c.yellow;

// Matches only SGR (Select Graphic Rendition) codes: ESC [ <params> m
// This is sufficient because c.* wrappers only produce SGR sequences.
export function stripAnsi(s: string): string {
  const pattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return s.replace(pattern, "");
}
