import { describe, expect, it } from "bun:test";

import { GLOBAL_FLAGS } from "../../../lib/help/registry";
import { stripAnsi } from "../../../lib/render/color";
import { formatError } from "../../../lib/render/formatters/errors";
import { type HelpView, helpText } from "../../../lib/render/formatters/help";
import { repoAddText, repoListText } from "../../../lib/render/formatters/repo";
import { statusText } from "../../../lib/render/formatters/status";
import { workspaceListText } from "../../../lib/render/formatters/workspace";
import { worktreeListText } from "../../../lib/render/formatters/worktree";

const fixtures = {
  workspaceList: [
    { name: "ai", path: "/x/ai" },
    { name: "demo", path: "/x/demo" },
  ],
  repoList: [
    { name: "grove", path: "/x/grove", status: "ok" as const },
    { name: "web", path: "/x/web", status: "dangling" as const },
  ],
  worktreeList: [
    { repo: "grove", slug: "main", branch: "main", type: "linked" as const },
    { repo: "grove", slug: "feat", branch: "feat", type: "worktree" as const },
  ],
  status: {
    name: "ai",
    path: "/x/ai",
    repos: [
      {
        name: "grove",
        path: "/x/grove",
        status: "ok" as const,
        worktrees: [{ repo: "grove", slug: "main", branch: "main", type: "linked" as const }],
      },
    ],
  },
};

const helpView: HelpView = {
  path: ["grove"],
  node: {
    kind: "group",
    name: "grove",
    summary: "manage workspaces",
    children: [
      {
        kind: "leaf",
        name: "ws",
        summary: "manage workspaces, repos, and worktrees",
      },
    ],
  },
  globalFlags: GLOBAL_FLAGS,
};

const ttyOn = { colorEnabled: true, unicodeEnabled: true, isTTY: true, isStderrTTY: true };
const ttyOff = { colorEnabled: false, unicodeEnabled: true, isTTY: true, isStderrTTY: true };

describe("color-strip equivalence", () => {
  it("workspaceListText: stripAnsi(color-on) === color-off", () => {
    expect(stripAnsi(workspaceListText(fixtures.workspaceList, ttyOn))).toBe(
      workspaceListText(fixtures.workspaceList, ttyOff),
    );
  });

  it("repoListText: stripAnsi(color-on) === color-off", () => {
    expect(stripAnsi(repoListText(fixtures.repoList, ttyOn))).toBe(
      repoListText(fixtures.repoList, ttyOff),
    );
  });

  it("worktreeListText: stripAnsi(color-on) === color-off", () => {
    expect(stripAnsi(worktreeListText(fixtures.worktreeList, ttyOn))).toBe(
      worktreeListText(fixtures.worktreeList, ttyOff),
    );
  });

  it("statusText: stripAnsi(color-on) === color-off", () => {
    expect(stripAnsi(statusText(fixtures.status, ttyOn))).toBe(statusText(fixtures.status, ttyOff));
  });

  it("formatError: stripAnsi(color-on) === color-off", () => {
    expect(stripAnsi(formatError("oops", "BAD", { colorEnabled: true }))).toBe(
      formatError("oops", "BAD", { colorEnabled: false }),
    );
  });

  it("helpText: stripAnsi(color-on) === color-off", () => {
    const colored = helpText(helpView, { colorEnabled: true, unicodeEnabled: true });
    const plain = helpText(helpView, { colorEnabled: false, unicodeEnabled: true });
    expect(stripAnsi(colored)).toBe(plain);
  });
});

describe("ASCII fallback preserves identifiers", () => {
  it("statusText with unicode=false includes every name and status word", () => {
    const out = statusText(fixtures.status, { ...ttyOff, unicodeEnabled: false });
    expect(out).toContain("ai");
    expect(out).toContain("grove");
    expect(out).toContain("/x/grove");
    expect(out).toContain("ok");
    expect(out).toContain("main");
    expect(out).toContain("linked");
  });

  it("statusText with unicode=false uses no unicode tree chars", () => {
    const out = statusText(fixtures.status, { ...ttyOff, unicodeEnabled: false });
    expect(out).not.toContain("├");
    expect(out).not.toContain("└");
    expect(out).not.toContain("│");
  });

  it("repoAddText with unicode=false uses ASCII arrow", () => {
    const out = repoAddText(
      {
        name: "g",
        path: "/x",
        status: "ok",
        workspace: "ai",
        defaultBranchSlug: "main",
        worktreePath: "trees/g/main",
      },
      { ...ttyOff, unicodeEnabled: false },
    );
    expect(out).toContain("->");
    expect(out).not.toContain("→");
  });

  it("helpText with unicode=false uses ASCII em-dash and contains flag names", () => {
    const out = helpText(helpView, { colorEnabled: false, unicodeEnabled: false });
    expect(out).toContain("grove -- manage workspaces");
    expect(out).not.toContain("—");
    expect(out).toContain("--json");
    expect(out).toContain("--ascii");
  });
});

describe("greppability — literal status words appear in every text mode", () => {
  it.each([
    [
      "color on, unicode on",
      { colorEnabled: true, unicodeEnabled: true, isTTY: true, isStderrTTY: true },
    ],
    [
      "color off, unicode on",
      { colorEnabled: false, unicodeEnabled: true, isTTY: true, isStderrTTY: true },
    ],
    [
      "color on, unicode off",
      { colorEnabled: true, unicodeEnabled: false, isTTY: true, isStderrTTY: true },
    ],
    [
      "color off, unicode off",
      { colorEnabled: false, unicodeEnabled: false, isTTY: true, isStderrTTY: true },
    ],
  ])("repoListText (%s) contains 'ok' and 'dangling' in plain text", (_, ctx) => {
    const text = stripAnsi(repoListText(fixtures.repoList, ctx));
    expect(text).toContain("ok");
    expect(text).toContain("dangling");
  });

  it("formatError contains 'error:' and the literal code", () => {
    const text = stripAnsi(formatError("foo", "WORKSPACE_NOT_FOUND", { colorEnabled: true }));
    expect(text).toContain("error:");
    expect(text).toContain("WORKSPACE_NOT_FOUND");
  });
});
