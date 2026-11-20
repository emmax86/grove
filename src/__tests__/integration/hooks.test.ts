import { describe, expect, it } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const CANONICAL_SKILLS_DIR = path.join(REPO_ROOT, "skills");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const CLAUDE_PLUGIN_DIR = path.join(PLUGINS_DIR, "claude");
const CODEX_PLUGIN_DIR = path.join(PLUGINS_DIR, "codex");
const ANTIGRAVITY_PLUGIN_DIR = path.join(PLUGINS_DIR, "antigravity");
const LEGACY_SHARED_PLUGIN_DIR = path.join(PLUGINS_DIR, "grove");

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir: string, prefix = ""): Promise<Map<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await collectFiles(full, rel)) {
        files.set(k, v);
      }
    } else {
      files.set(rel, await readFile(full, "utf8"));
    }
  }
  return files;
}

describe("per-harness plugin layout", () => {
  it("replaces the overloaded plugins/grove directory with separate per-harness plugins", async () => {
    expect(await exists(LEGACY_SHARED_PLUGIN_DIR)).toBe(false);
    expect(await exists(CLAUDE_PLUGIN_DIR)).toBe(true);
    expect(await exists(CODEX_PLUGIN_DIR)).toBe(true);
    expect(await exists(ANTIGRAVITY_PLUGIN_DIR)).toBe(true);
  });

  it("wires marketplace manifests to their dedicated harness plugin directories", async () => {
    const claudeMarketplace = JSON.parse(
      await readFile(path.join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    ) as { plugins: [{ source: string }] };
    expect(claudeMarketplace.plugins[0].source).toBe("./plugins/claude");

    const codexMarketplace = JSON.parse(
      await readFile(path.join(REPO_ROOT, ".agents/plugins/marketplace.json"), "utf8"),
    ) as { plugins: [{ source: { path: string } }] };
    expect(codexMarketplace.plugins[0].source.path).toBe("./plugins/codex");
  });

  it("packages plugins/claude with .claude-plugin manifest and grove hook CLI command", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(CLAUDE_PLUGIN_DIR, ".claude-plugin/plugin.json"), "utf8"),
    ) as { name: string; hooks?: unknown };
    expect(manifest.name).toBe("grove");
    expect(manifest.hooks).toBeUndefined();

    const hookConfig = JSON.parse(
      await readFile(path.join(CLAUDE_PLUGIN_DIR, "hooks/hooks.json"), "utf8"),
    ) as { hooks: { PreToolUse: [{ matcher: string; hooks: [{ command: string }] }] } };
    expect(hookConfig.hooks.PreToolUse).toHaveLength(1);
    expect(hookConfig.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(hookConfig.hooks.PreToolUse[0].hooks[0].command).toBe(
      "grove hook reject-git-worktree --host claude",
    );
  });

  it("packages plugins/codex with .codex-plugin manifest (no hooks field) and grove hook CLI command", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(CODEX_PLUGIN_DIR, ".codex-plugin/plugin.json"), "utf8"),
    ) as { name: string; hooks?: unknown };
    expect(manifest.name).toBe("grove");
    expect(manifest.hooks).toBeUndefined();
    expect(await exists(path.join(CODEX_PLUGIN_DIR, "hooks.json"))).toBe(false);

    const hookConfig = JSON.parse(
      await readFile(path.join(CODEX_PLUGIN_DIR, "hooks/hooks.json"), "utf8"),
    ) as { hooks: { PreToolUse: [{ matcher: string; hooks: [{ command: string }] }] } };
    expect(hookConfig.hooks.PreToolUse).toHaveLength(1);
    expect(hookConfig.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(hookConfig.hooks.PreToolUse[0].hooks[0].command).toBe(
      "grove hook reject-git-worktree --host codex",
    );
  });

  it("packages plugins/antigravity with root plugin.json and root hooks.json", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(ANTIGRAVITY_PLUGIN_DIR, "plugin.json"), "utf8"),
    ) as { name: string; hooks?: unknown };
    expect(manifest.name).toBe("grove");
    expect(manifest.hooks).toBeUndefined();

    const hookConfig = JSON.parse(
      await readFile(path.join(ANTIGRAVITY_PLUGIN_DIR, "hooks.json"), "utf8"),
    ) as {
      hooks?: unknown;
      "reject-git-worktree": {
        PreToolUse: [{ matcher: string; hooks: [{ type: string; command: string }] }];
      };
    };
    expect(hookConfig.hooks).toBeUndefined();
    expect(hookConfig["reject-git-worktree"].PreToolUse).toHaveLength(1);
    expect(hookConfig["reject-git-worktree"].PreToolUse[0].matcher).toBe("run_command");
    expect(hookConfig["reject-git-worktree"].PreToolUse[0].hooks[0].command).toBe(
      "grove hook reject-git-worktree --host antigravity",
    );
  });

  it("keeps skills/ synced identically across all harness plugin directories (run `bun run sync:plugins` on drift)", async () => {
    const canonical = await collectFiles(CANONICAL_SKILLS_DIR);
    expect(canonical.size).toBeGreaterThan(0);

    for (const pluginDir of [CLAUDE_PLUGIN_DIR, CODEX_PLUGIN_DIR, ANTIGRAVITY_PLUGIN_DIR]) {
      const synced = await collectFiles(path.join(pluginDir, "skills"));
      expect(synced).toEqual(canonical);
    }
  });
});
