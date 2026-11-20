import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

export const SKILL_PLUGIN_TARGETS = ["claude", "codex", "antigravity", "opencode"] as const;

const repoRoot = resolve(import.meta.dir, "..");
const canonicalSkillsDir = resolve(repoRoot, "skills");

for (const target of SKILL_PLUGIN_TARGETS) {
  const dest = resolve(repoRoot, "plugins", target, "skills");
  await rm(dest, { recursive: true, force: true });
  await cp(canonicalSkillsDir, dest, { recursive: true });
  console.log(`synced ${dest}`);
}
