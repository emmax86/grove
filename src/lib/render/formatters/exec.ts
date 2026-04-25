import type { FormatCtx } from "./workspace";

export interface ExecDryRunValue {
  repo: string;
  cwd: string;
  command: string[];
}

export function execDryRunText(v: ExecDryRunValue, _ctx: FormatCtx): string {
  return `would run: ${v.command.join(" ")}\n  in: ${v.cwd}\n  for: ${v.repo}`;
}

export function execDryRunPorcelain(v: ExecDryRunValue): string {
  return `${v.repo}\t${v.cwd}\t${v.command.join(" ")}`;
}
