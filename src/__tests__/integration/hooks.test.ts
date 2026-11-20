import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cleanup, createTestDir } from "../helpers";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const CLI_ENTRY = path.join(REPO_ROOT, "src/cli.ts");
const CANONICAL_SKILLS_DIR = path.join(REPO_ROOT, "skills");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const CLAUDE_PLUGIN_DIR = path.join(PLUGINS_DIR, "claude");
const CODEX_PLUGIN_DIR = path.join(PLUGINS_DIR, "codex");
const ANTIGRAVITY_PLUGIN_DIR = path.join(PLUGINS_DIR, "antigravity");
const OPENCODE_PLUGIN_DIR = path.join(PLUGINS_DIR, "opencode");
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
    expect(await exists(OPENCODE_PLUGIN_DIR)).toBe(true);
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

  it("packages plugins/opencode as an OpenCode v2 plugin with Plugin.define and execute.before hook", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(OPENCODE_PLUGIN_DIR, "package.json"), "utf8"),
    ) as {
      name: string;
      type: string;
      exports: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe("grove-opencode-plugin");
    expect(pkg.type).toBe("module");
    expect(pkg.exports["."]).toBe("./index.js");
    expect(pkg.peerDependencies?.["@opencode/plugin"]).toBeDefined();

    const entrypoint = await readFile(path.join(OPENCODE_PLUGIN_DIR, "index.js"), "utf8");
    expect(entrypoint).toContain("@opencode/plugin");
    expect(entrypoint).toContain("Plugin.define");
    expect(entrypoint).toContain('ctx.tool.hook("execute.before"');
    expect(entrypoint).toContain("createRejectGitWorktreeHook({ ctx })");
  });

  it("keeps skills/ synced identically across all harness plugin directories (run `bun run sync:plugins` on drift)", async () => {
    const canonical = await collectFiles(CANONICAL_SKILLS_DIR);
    expect(canonical.size).toBeGreaterThan(0);

    for (const pluginDir of [
      CLAUDE_PLUGIN_DIR,
      CODEX_PLUGIN_DIR,
      ANTIGRAVITY_PLUGIN_DIR,
      OPENCODE_PLUGIN_DIR,
    ]) {
      const synced = await collectFiles(path.join(pluginDir, "skills"));
      expect(synced).toEqual(canonical);
    }
  });
});

type OpenCodeHookContext = {
  location?: { directory?: string };
  directory?: string;
  session?: {
    get: (input: { sessionID: string }) => Promise<{ directory?: string } | undefined>;
  };
};

type OpenCodeHookFactory = (options: {
  ctx?: OpenCodeHookContext;
  directory?: string;
  groveCommand?: string[];
  env?: Record<string, string | undefined>;
}) => (event: {
  tool?: string;
  sessionID?: string;
  directory?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
}) => Promise<void>;

describe("OpenCode v2 plugin execute.before adapter", () => {
  let tempDir: string;
  let groveRoot: string;
  let groveCwd: string;
  let nonGroveCwd: string;

  beforeEach(async () => {
    tempDir = await createTestDir();
    groveRoot = path.join(tempDir, "grove-workspaces");
    groveCwd = path.join(groveRoot, "myws", "trees", "myrepo", "main");
    nonGroveCwd = path.join(tempDir, "other-project");
    await mkdir(groveCwd, { recursive: true });
    await mkdir(nonGroveCwd, { recursive: true });
  });

  afterEach(() => cleanup(tempDir));

  async function loadHookFactory(): Promise<OpenCodeHookFactory> {
    const modPath = path.join(OPENCODE_PLUGIN_DIR, "reject-git-worktree.js");
    const mod = (await import(pathToFileURL(modPath).href)) as {
      createRejectGitWorktreeHook: OpenCodeHookFactory;
    };
    return mod.createRejectGitWorktreeHook;
  }

  it("throws with Grove denial reason on git worktree inside GROVE_ROOT", async () => {
    const createHook = await loadHookFactory();
    const hook = createHook({
      directory: groveCwd,
      groveCommand: ["bun", "run", CLI_ENTRY],
      env: { ...process.env, GROVE_ROOT: groveRoot },
    });

    await expect(hook({ tool: "bash", input: { command: "git worktree list" } })).rejects.toThrow(
      "Direct git worktree commands are not allowed in grove workspaces.",
    );

    await expect(
      hook({ tool: "shell", input: { command: "git worktree add ../foo" } }),
    ).rejects.toThrow("Direct git worktree commands are not allowed in grove workspaces.");
  });

  it("allows safe commands inside GROVE_ROOT, git worktree outside GROVE_ROOT, and non-shell tools", async () => {
    const createHook = await loadHookFactory();
    const env = { ...process.env, GROVE_ROOT: groveRoot };
    const groveCommand = ["bun", "run", CLI_ENTRY];

    const insideHook = createHook({ directory: groveCwd, groveCommand, env });
    await expect(
      insideHook({ tool: "bash", input: { command: "git status" } }),
    ).resolves.toBeUndefined();
    await expect(
      insideHook({ tool: "read", input: { filePath: "git worktree" } }),
    ).resolves.toBeUndefined();

    const outsideHook = createHook({ directory: nonGroveCwd, groveCommand, env });
    await expect(
      outsideHook({ tool: "bash", input: { command: "git worktree list" } }),
    ).resolves.toBeUndefined();
  });

  it("resolves the session directory per event via event.sessionID instead of capturing plugin load location", async () => {
    const createHook = await loadHookFactory();
    const sessions = new Map<string, { directory: string }>([
      ["ses_grove", { directory: groveCwd }],
      ["ses_other", { directory: nonGroveCwd }],
    ]);
    const sessionApi = {
      get: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID),
    };
    const groveCommand = ["bun", "run", CLI_ENTRY];
    const env = { ...process.env, GROVE_ROOT: groveRoot };

    // Plugin loaded outside GROVE_ROOT must still deny a session running inside GROVE_ROOT.
    const hookLoadedOutside = createHook({
      ctx: { location: { directory: nonGroveCwd }, session: sessionApi },
      groveCommand,
      env,
    });
    await expect(
      hookLoadedOutside({
        tool: "shell",
        sessionID: "ses_grove",
        input: { command: "git worktree list" },
      }),
    ).rejects.toThrow("Direct git worktree commands are not allowed in grove workspaces.");

    // Plugin loaded inside GROVE_ROOT must allow an unrelated session running outside GROVE_ROOT.
    const hookLoadedInside = createHook({
      ctx: { location: { directory: groveCwd }, session: sessionApi },
      groveCommand,
      env,
    });
    await expect(
      hookLoadedInside({
        tool: "shell",
        sessionID: "ses_other",
        input: { command: "git worktree list" },
      }),
    ).resolves.toBeUndefined();

    // If session lookup fails for a session event, fail open rather than falling back to plugin load location.
    const hookWithFailingLookup = createHook({
      ctx: {
        location: { directory: groveCwd },
        session: {
          get: async () => {
            throw new Error("session lookup failed");
          },
        },
      },
      groveCommand,
      env,
    });
    await expect(
      hookWithFailingLookup({
        tool: "shell",
        sessionID: "ses_unknown",
        input: { command: "git worktree list" },
      }),
    ).resolves.toBeUndefined();
  });

  it("fails open when the grove binary cannot be spawned", async () => {
    const createHook = await loadHookFactory();
    const hook = createHook({
      directory: groveCwd,
      groveCommand: ["nonexistent-grove-binary-for-test"],
      env: { ...process.env, GROVE_ROOT: groveRoot },
    });

    await expect(
      hook({ tool: "bash", input: { command: "git worktree list" } }),
    ).resolves.toBeUndefined();
  });
});
