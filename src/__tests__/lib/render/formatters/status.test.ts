import { describe, expect, it } from "bun:test";

import {
  type StatusValue,
  statusPorcelain,
  statusText,
} from "../../../../lib/render/formatters/status";

const fixture: StatusValue = {
  name: "ai",
  path: "/home/emma/grove-workspaces/ai",
  repos: [
    {
      name: "grove",
      path: "/home/emma/projects/grove",
      status: "ok",
      worktrees: [
        { repo: "grove", slug: "main", branch: "main", type: "linked" },
        { repo: "grove", slug: "feat-auth", branch: "feat-auth", type: "worktree" },
      ],
    },
    { name: "web", path: "/home/emma/code/web", status: "dangling", worktrees: [] },
  ],
};

const baseCtx = { colorEnabled: false, unicodeEnabled: true, isTTY: false, isStderrTTY: false };

describe("statusText", () => {
  it("renders unicode tree", () => {
    expect(statusText(fixture, baseCtx)).toBe(
      [
        "ai (/home/emma/grove-workspaces/ai)",
        "├── grove (/home/emma/projects/grove) [ok]",
        "│   ├── main (linked)",
        "│   └── feat-auth (worktree, branch: feat-auth)",
        "└── web (/home/emma/code/web) [dangling]",
      ].join("\n"),
    );
  });

  it("renders ASCII fallback when unicodeEnabled=false", () => {
    expect(statusText(fixture, { ...baseCtx, unicodeEnabled: false })).toBe(
      [
        "ai (/home/emma/grove-workspaces/ai)",
        "+-- grove (/home/emma/projects/grove) [ok]",
        "|   +-- main (linked)",
        "|   `-- feat-auth (worktree, branch: feat-auth)",
        "`-- web (/home/emma/code/web) [dangling]",
      ].join("\n"),
    );
  });

  it("workspace with no repos", () => {
    expect(statusText({ name: "ai", path: "/x/ai", repos: [] }, baseCtx)).toBe("ai (/x/ai)");
  });
});

describe("statusPorcelain", () => {
  it("denormalizes one row per worktree", () => {
    expect(statusPorcelain(fixture)).toBe(
      [
        "grove\t/home/emma/projects/grove\tok\tmain\tmain\tlinked",
        "grove\t/home/emma/projects/grove\tok\tfeat-auth\tfeat-auth\tworktree",
        "web\t/home/emma/code/web\tdangling\t\t\t",
      ].join("\n"),
    );
  });

  it("empty repos", () => {
    expect(statusPorcelain({ name: "ai", path: "/x", repos: [] })).toBe("");
  });
});
