import { describe, expect, it } from "bun:test";

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", GROVE_ROOT: "/tmp/grove-help-test-root" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("help: top level", () => {
  it("grove --help -> top-level help on stdout, exit 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove");
    expect(r.stdout).toContain("Commands:");
    expect(r.stdout).toContain("ws");
    expect(r.stderr).toBe("");
  });

  it("grove -h -> same as --help", async () => {
    const a = await runCli(["-h"]);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toContain("Commands:");
  });

  it("grove help -> same as --help", async () => {
    const a = await runCli(["help"]);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toContain("Commands:");
  });

  it("grove with no args -> top-level help, exit 0", async () => {
    const a = await runCli([]);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toContain("Commands:");
    expect(a.stderr).toBe("");
  });
});

describe("help: subcommand", () => {
  it("grove ws --help -> ws group help", async () => {
    const r = await runCli(["ws", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove ws");
    expect(r.stdout).toContain("Subcommands:");
  });

  it("grove ws repo add --help -> leaf help with arguments and example", async () => {
    const r = await runCli(["ws", "repo", "add", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove ws repo add");
    expect(r.stdout).toContain("Arguments:");
    expect(r.stdout).toContain("<path>");
    expect(r.stdout).toContain("Examples:");
  });

  it("position invariance: --help anywhere yields the same path", async () => {
    const a = await runCli(["ws", "repo", "add", "--help"]);
    const b = await runCli(["--help", "ws", "repo", "add"]);
    const c = await runCli(["ws", "--help", "repo", "add"]);
    expect(a.stdout).toBe(b.stdout);
    expect(b.stdout).toBe(c.stdout);
  });

  it("alias workspaces resolves to ws", async () => {
    const r = await runCli(["workspaces", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove ws");
  });

  it("typo with --help -> deepest match plus 'note:' line", async () => {
    const r = await runCli(["ws", "fooo", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split("\n")[0]).toContain("note:");
    expect(r.stdout).toContain("Subcommands:");
  });

  it("leaf with positional arg + --help -> no spurious typo note", async () => {
    // `/path` is the value of the required <path> arg, not an unknown subcommand.
    const r = await runCli(["ws", "repo", "add", "/some/path", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("unknown subcommand");
    expect(r.stdout).not.toContain("note:");
    expect(r.stdout).toContain("grove ws repo add");
  });

  it("typo note under --ascii uses '--' not em-dash", async () => {
    const r = await runCli(["ws", "fooo", "--help", "--ascii"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("note:");
    // Whole stdout (note + body) must be ASCII-clean under --ascii
    expect(r.stdout).not.toContain("—");
    expect(r.stdout).toContain("--");
  });

  it("grove mcp-server --help -> leaf help, exit 0, daemon NOT started", async () => {
    const r = await runCli(["mcp-server", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove mcp-server");
    expect(r.stdout).toContain("Flags:");
    expect(r.stderr).not.toContain("[mcp-server] listening");
  });

  it("grove mcp-server --workspace foo --help -> help, NOT daemon start", async () => {
    const r = await runCli(["mcp-server", "--workspace", "foo", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("grove mcp-server");
    expect(r.stderr).not.toContain("[mcp-server] listening");
  });
});

describe("help: output modes", () => {
  it("grove --help --json -> full JSON tree, exit 0", async () => {
    const r = await runCli(["--help", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.path).toEqual(["grove"]);
    expect(parsed.data.node.kind).toBe("group");
    expect(parsed.data.node.children.length).toBeGreaterThan(0);
  });

  it("grove ws worktree add --help --porcelain -> single tab row", async () => {
    const r = await runCli(["ws", "worktree", "add", "--help", "--porcelain"]);
    expect(r.exitCode).toBe(0);
    const rows = r.stdout.trim().split("\n");
    expect(rows.length).toBe(1);
    expect(rows[0].split("\t").length).toBe(3);
    expect(rows[0]).toContain("grove ws worktree add\tleaf\t");
  });

  it("grove --help --json --porcelain -> INVALID_FLAGS, exit 1 (regression)", async () => {
    const r = await runCli(["--help", "--json", "--porcelain"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("mutually exclusive");
  });
});

describe("help: missing required argument", () => {
  it("grove ws add with no name -> MISSING_ARG plus help on stderr, exit 1", async () => {
    const r = await runCli(["ws", "add"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: name");
    expect(r.stderr).toContain("grove ws add");
    expect(r.stderr).toContain("Arguments:");
  });

  it("grove ws add --json with no name -> JSON envelope with help payload, exit 1", async () => {
    const r = await runCli(["ws", "add", "--json"]);
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stderr);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MISSING_ARG");
    expect(parsed.help.path).toEqual(["grove", "ws", "add"]);
    expect(parsed.help.node.name).toBe("add");
  });

  it("grove ws repo add --workspace foo (no path) -> MISSING_ARG names path", async () => {
    const r = await runCli(["ws", "repo", "add", "--workspace", "foo"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: path");
    expect(r.stderr).toContain("grove ws repo add");
  });

  it("grove ws repo add /path (no workspace) -> MISSING_ARG names workspace, not path", async () => {
    const r = await runCli(["ws", "repo", "add", "/some/path"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: workspace");
  });

  it("grove ws repo remove name (no workspace) -> MISSING_ARG names workspace, not name", async () => {
    const r = await runCli(["ws", "repo", "remove", "somename"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: workspace");
  });

  it("grove ws worktree add (no args) -> MISSING_ARG names workspace, not branch", async () => {
    const r = await runCli(["ws", "worktree", "add"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: workspace");
  });

  it("grove ws worktree add --workspace foo (no repo, no branch) -> MISSING_ARG names repo", async () => {
    // 1 wtArg "main" is parsed as the branch; repo is uninferable -> repo is the missing one.
    const r = await runCli(["ws", "worktree", "add", "--workspace", "foo", "main"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: repo");
  });

  it("grove ws worktree list (no workspace) -> MISSING_ARG names workspace, not repo", async () => {
    const r = await runCli(["ws", "worktree", "list"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: workspace");
  });

  it("grove ws worktree list --workspace foo (no repo) -> MISSING_ARG names repo", async () => {
    const r = await runCli(["ws", "worktree", "list", "--workspace", "foo"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: repo");
  });

  it("grove ws worktree remove slug (no workspace) -> MISSING_ARG names workspace, not slug", async () => {
    const r = await runCli(["ws", "worktree", "remove", "someslug"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: workspace");
  });

  it("grove ws exec with no command -> MISSING_ARG with ws exec help", async () => {
    const r = await runCli(["ws", "exec", "--workspace", "myws"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("missing required argument: command");
    expect(r.stderr).toContain("grove ws exec");
  });

  it("grove mcp-server --json (no workspace) -> MISSING_ARG JSON envelope", async () => {
    const r = await runCli(["mcp-server", "--json"]);
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stderr);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MISSING_ARG");
    expect(parsed.help.path).toEqual(["grove", "mcp-server"]);
  });
});

describe("help: regression — non-help flows unchanged", () => {
  it("grove fooo -> UNKNOWN_COMMAND, exit 1", async () => {
    const r = await runCli(["fooo"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("UNKNOWN_COMMAND");
  });

  it("grove ws add help -> creates a workspace named 'help', NOT help mode", async () => {
    const r = await runCli(["ws", "add", "help"]);
    // It should attempt to create the workspace (will fail because the test GROVE_ROOT
    // doesn't exist, but the failure mode must be a workspace-create error, NOT help output)
    expect(r.stdout).not.toContain("Commands:");
    expect(r.stdout).not.toContain("Subcommands:");
    expect(r.stdout).not.toContain("Arguments:");
    // Either succeeded (unlikely with bogus GROVE_ROOT) or failed with a real workspace error
    // Both are acceptable — the failure mode "showed help instead" is what we're guarding against
  });
});
