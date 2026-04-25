import { c } from "../color";

export interface ErrorFormatCtx {
  colorEnabled: boolean;
}

export function formatError(error: string, code: string, ctx: ErrorFormatCtx): string {
  const errorLabel = c.bold(c.red("error:", ctx.colorEnabled), ctx.colorEnabled);
  const codeLabel = c.dim(c.red("code:", ctx.colorEnabled), ctx.colorEnabled);
  return `${errorLabel} ${error}\n  ${codeLabel} ${code}`;
}
