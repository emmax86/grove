import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_COMMANDS_CONFIG } from "../constants";
import type { Ecosystem } from "./detect";

export type StandardCommand = "setup" | "format" | "test" | "test:file" | "test:match" | "check";

export interface CommandConfig {
  setup?: string | string[];
  format?: string | string[];
  test?: string | string[];
  "test:file"?: string | string[];
  "test:match"?: string | string[];
  check?: string | string[];
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  env?: Record<string, string | undefined>;
}

export async function loadCommandConfig(repoRoot: string): Promise<CommandConfig | null> {
  const configPath = join(repoRoot, REPO_COMMANDS_CONFIG);
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as CommandConfig;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`[warn] Failed to parse ${configPath}: ${String(e)}\n`);
      return null;
    }
    // .grove/commands.json not found — check for legacy .dotclaude/commands.json
    const legacyPath = join(repoRoot, ".dotclaude", "commands.json");
    let legacyRaw: string;
    try {
      legacyRaw = await readFile(legacyPath, "utf8");
    } catch {
      return null;
    }
    try {
      const config = JSON.parse(legacyRaw) as CommandConfig;
      process.stderr.write(
        `[grove] Warning: .dotclaude/commands.json is deprecated. Rename it to .grove/commands.json.\n`,
      );
      return config;
    } catch (e) {
      process.stderr.write(`[warn] Failed to parse ${legacyPath}: ${String(e)}\n`);
      return null;
    }
  }
}

export function resolveCommand(
  command: StandardCommand,
  config: CommandConfig | null,
  ecosystem: Ecosystem | null,
  opts: { file?: string; match?: string },
): string[] | null {
  const raw = config?.[command];

  let cmd: string[] | null = null;

  if (raw !== undefined) {
    // Config takes precedence
    if (typeof raw === "string") {
      // String form: run via shell (supports && etc.).
      // Note: {file} and {match} tokens inside the string are NOT substituted —
      // use array form (e.g. ["prettier", "--write", "{file}"]) if you need placeholders.
      cmd = ["sh", "-c", raw];
    } else if (Array.isArray(raw)) {
      cmd = raw.slice();
    } else {
      process.stderr.write(
        `[warn] Command "${command}" in .grove/commands.json must be a string or array, got ${typeof raw} — skipping\n`,
      );
    }
  } else if (ecosystem) {
    // Auto-detect from ecosystem
    if (command === "setup") {
      cmd = ecosystem.setup.slice();
    } else if (command === "format") {
      cmd = ecosystem.format.slice();
    } else if (command === "test") {
      cmd = ecosystem.test.slice();
    }
    // test:file, test:match, check are not auto-detected
  }

  if (!cmd) {
    return null;
  }

  // Substitute {file} and {match} placeholders — each replaces exactly one array element.
  // Unsubstituted placeholders (opts.file/opts.match not provided) are removed from the array
  // so commands like `prettier --write {file}` degrade gracefully to `prettier --write`.
  return cmd.flatMap((arg) => {
    if (arg === "{file}") {
      return opts.file !== undefined ? [opts.file] : [];
    }
    if (arg === "{match}") {
      return opts.match !== undefined ? [opts.match] : [];
    }
    return [arg];
  });
}

export async function spawnCommand(
  cmd: string[],
  cwd: string,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  process.stderr.write(`[exec] $ ${cmd.join(" ")}\n`);

  const proc = Bun.spawn(cmd, {
    cwd,
    env: options?.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode: exitCode ?? 1, stdout, stderr };
}
