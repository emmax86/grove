import { describe, expect, it } from "bun:test";

import {
  repoAddPorcelain,
  repoAddText,
  repoListPorcelain,
  repoListText,
  repoRemovePorcelain,
  repoRemoveText,
} from "../../../../lib/render/formatters/repo";

const baseCtx = { colorEnabled: false, unicodeEnabled: true, isTTY: false, isStderrTTY: false };

describe("repoAdd", () => {
  it("text: two-line success with worktree path from worktreePath field", () => {
    const out = repoAddText(
      {
        name: "grove",
        path: "/home/emma/projects/grove",
        status: "ok",
        workspace: "ai",
        defaultBranchSlug: "main",
        worktreePath: "trees/grove/main",
      },
      baseCtx,
    );
    expect(out).toBe(
      "Added repo 'grove' → /home/emma/projects/grove\n  worktree: trees/grove/main",
    );
  });

  it("text: worktree path uses worktreePath field (not hardcoded)", () => {
    const out = repoAddText(
      {
        name: "api",
        path: "/x/api",
        status: "ok",
        workspace: "ai",
        defaultBranchSlug: "master",
        worktreePath: "trees/api/master",
      },
      baseCtx,
    );
    expect(out).toBe("Added repo 'api' → /x/api\n  worktree: trees/api/master");
  });

  it("text: worktree path reflects actual Paths config", () => {
    const out = repoAddText(
      {
        name: "web",
        path: "/home/user/web",
        status: "ok",
        workspace: "staging",
        defaultBranchSlug: "develop",
        worktreePath: "custom-trees/web/develop",
      },
      baseCtx,
    );
    expect(out).toBe("Added repo 'web' → /home/user/web\n  worktree: custom-trees/web/develop");
  });

  it("text with --ascii arrow fallback", () => {
    const out = repoAddText(
      {
        name: "grove",
        path: "/x/grove",
        status: "ok",
        workspace: "ai",
        defaultBranchSlug: "main",
        worktreePath: "trees/grove/main",
      },
      { ...baseCtx, unicodeEnabled: false },
    );
    expect(out).toBe("Added repo 'grove' -> /x/grove\n  worktree: trees/grove/main");
  });

  it("porcelain: name<TAB>path<TAB>status (worktreePath not included)", () => {
    expect(
      repoAddPorcelain({
        name: "grove",
        path: "/x",
        status: "ok",
        workspace: "ai",
        defaultBranchSlug: "main",
        worktreePath: "trees/grove/main",
      }),
    ).toBe("grove\t/x\tok");
  });
});

describe("repoList", () => {
  it("text TTY: aligned with header", () => {
    const out = repoListText(
      [
        { name: "grove", path: "/home/emma/projects/grove", status: "ok" },
        { name: "web", path: "/home/emma/code/web", status: "dangling" },
      ],
      { ...baseCtx, isTTY: true },
    );
    expect(out).toBe(
      "NAME   PATH                       STATUS\ngrove  /home/emma/projects/grove  ok\nweb    /home/emma/code/web        dangling",
    );
  });

  it("text non-TTY: no header", () => {
    const out = repoListText([{ name: "grove", path: "/x", status: "ok" }], baseCtx);
    expect(out).toBe("grove  /x  ok");
  });

  it("porcelain", () => {
    expect(
      repoListPorcelain([
        { name: "a", path: "/x", status: "ok" },
        { name: "b", path: "/y", status: "dangling" },
      ]),
    ).toBe("a\t/x\tok\nb\t/y\tdangling");
  });
});

describe("repoRemove", () => {
  it("text", () => {
    expect(repoRemoveText({ name: "grove", workspace: "ai" }, baseCtx)).toBe(
      "Removed repo 'grove' from workspace 'ai'",
    );
  });
  it("porcelain", () => {
    expect(repoRemovePorcelain({ name: "grove", workspace: "ai" })).toBe("grove\tremoved");
  });
});
