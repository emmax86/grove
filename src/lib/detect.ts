import { exists } from "node:fs/promises";
import { join } from "node:path";

export interface Ecosystem {
  name: string;
  signal: string;
  setup: string[];
  format: string[];
  test: string[];
}

// Priority order: first match wins. bun > pnpm > npm > uv.
export const ECOSYSTEMS: Ecosystem[] = [
  {
    name: "bun",
    signal: "bun.lock",
    setup: ["bun", "install"],
    format: ["bunx", "prettier", "--write", "{file}"],
    test: ["bun", "test"],
  },
  {
    name: "pnpm",
    signal: "pnpm-lock.yaml",
    setup: ["pnpm", "install"],
    format: ["pnpm", "exec", "prettier", "--write", "{file}"],
    test: ["pnpm", "test"],
  },
  {
    name: "npm",
    signal: "package-lock.json",
    setup: ["npm", "install"],
    format: ["npx", "prettier", "--write", "{file}"],
    test: ["npm", "test"],
  },
  {
    name: "uv",
    signal: "uv.lock",
    setup: ["uv", "sync"],
    format: ["uv", "run", "ruff", "format", "{file}"],
    test: ["uv", "run", "pytest"],
  },
];

export async function detectEcosystem(repoRoot: string): Promise<Ecosystem | null> {
  for (const eco of ECOSYSTEMS) {
    if (await exists(join(repoRoot, eco.signal))) {
      return eco;
    }
  }
  return null;
}
