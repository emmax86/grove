export interface UnicodeContext {
  argv: string[];
  env: Record<string, string | undefined>;
}

export function computeUnicodeEnabled(ctx: UnicodeContext): boolean {
  if (ctx.argv.includes("--ascii")) {
    return false;
  }
  if (ctx.env.LANG === "C" || ctx.env.LC_ALL === "C" || ctx.env.LC_CTYPE === "C") {
    return false;
  }
  if (ctx.env.TERM === "dumb") {
    return false;
  }
  return true;
}

export interface Chars {
  branch: string;
  lastBranch: string;
  vertical: string;
  arrow: string;
}

export function chars(unicode: boolean): Chars {
  return unicode
    ? { branch: "├──", lastBranch: "└──", vertical: "│", arrow: "→" }
    : { branch: "+--", lastBranch: "`--", vertical: "|", arrow: "->" };
}
