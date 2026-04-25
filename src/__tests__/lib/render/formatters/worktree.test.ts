import { describe, expect, it } from "bun:test";

import {
  worktreeAddPorcelain,
  worktreeAddText,
  worktreeListPorcelain,
  worktreeListText,
  worktreePrunePorcelain,
  worktreePruneText,
  worktreeRemovePorcelain,
  worktreeRemoveText,
} from "../../../../lib/render/formatters/worktree";

const baseCtx = { colorEnabled: false, unicodeEnabled: true, isTTY: false, isStderrTTY: false };

describe("worktreeAdd", () => {
  it("text new branch", () => {
    const out = worktreeAddText(
      {
        repo: "grove",
        slug: "feat-auth",
        branch: "feat-auth",
        type: "worktree",
        path: "trees/grove/feat-auth",
        isNew: true,
      },
      baseCtx,
    );
    expect(out).toBe(
      "Added worktree 'feat-auth' at trees/grove/feat-auth\n  branch: feat-auth (new)",
    );
  });

  it("text existing branch", () => {
    const out = worktreeAddText(
      {
        repo: "grove",
        slug: "main2",
        branch: "main2",
        type: "worktree",
        path: "trees/grove/main2",
        isNew: false,
      },
      baseCtx,
    );
    expect(out).toBe("Added worktree 'main2' at trees/grove/main2\n  branch: main2");
  });

  it("porcelain", () => {
    expect(
      worktreeAddPorcelain({
        repo: "grove",
        slug: "feat-auth",
        branch: "feat-auth",
        type: "worktree",
        path: "trees/grove/feat-auth",
        isNew: true,
      }),
    ).toBe("grove\tfeat-auth\tfeat-auth\tworktree\ttrees/grove/feat-auth");
  });
});

describe("worktreeList", () => {
  it("text TTY with header", () => {
    const out = worktreeListText(
      [
        { repo: "grove", slug: "main", branch: "main", type: "linked" },
        { repo: "grove", slug: "feat-auth", branch: "feat-auth", type: "worktree" },
      ],
      { ...baseCtx, isTTY: true },
    );
    expect(out).toBe(
      "REPO   SLUG       BRANCH     TYPE\ngrove  main       main       linked\ngrove  feat-auth  feat-auth  worktree",
    );
  });

  it("text non-TTY", () => {
    const out = worktreeListText(
      [{ repo: "grove", slug: "main", branch: "main", type: "linked" }],
      baseCtx,
    );
    expect(out).toBe("grove  main  main  linked");
  });

  it("porcelain", () => {
    expect(
      worktreeListPorcelain([
        { repo: "g", slug: "main", branch: "main", type: "linked" },
        { repo: "g", slug: "x", branch: "x", type: "worktree" },
      ]),
    ).toBe("g\tmain\tmain\tlinked\ng\tx\tx\tworktree");
  });
});

describe("worktreeRemove", () => {
  it("text", () => {
    expect(worktreeRemoveText({ repo: "grove", slug: "feat-x", workspace: "ai" }, baseCtx)).toBe(
      "Removed worktree 'feat-x' for repo 'grove' from workspace 'ai'",
    );
  });
  it("porcelain", () => {
    expect(worktreeRemovePorcelain({ repo: "grove", slug: "feat-x", workspace: "ai" })).toBe(
      "grove\tfeat-x\tremoved",
    );
  });
});

describe("worktreePrune", () => {
  it("text with pruned items", () => {
    const out = worktreePruneText(
      {
        workspace: "ai",
        pruned: [
          { repo: "grove", slug: "feat-old" },
          { repo: "grove", slug: "hotfix-x" },
        ],
      },
      baseCtx,
    );
    expect(out).toBe("Pruned 2 worktrees from workspace 'ai': feat-old, hotfix-x");
  });
  it("text empty", () => {
    expect(worktreePruneText({ workspace: "ai", pruned: [] }, baseCtx)).toBe(
      "Pruned 0 worktrees from workspace 'ai'",
    );
  });
  it("porcelain", () => {
    expect(
      worktreePrunePorcelain({
        workspace: "ai",
        pruned: [
          { repo: "g", slug: "a" },
          { repo: "g", slug: "b" },
        ],
      }),
    ).toBe("g\ta\ng\tb");
  });
  it("porcelain empty", () => {
    expect(worktreePrunePorcelain({ workspace: "ai", pruned: [] })).toBe("");
  });
});
