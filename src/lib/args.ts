import { collectValueTakingFlags } from "./help/dispatch";
import { type HelpGroup, REGISTRY } from "./help/registry";

export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[], registry: HelpGroup = REGISTRY): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valueFlags = collectValueTakingFlags(registry);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (valueFlags.has(key) && next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}
