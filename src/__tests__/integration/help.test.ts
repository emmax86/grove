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
