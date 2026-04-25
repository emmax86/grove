import { describe, expect, it } from "bun:test";

import {
  workspaceAddPorcelain,
  workspaceAddText,
  workspaceListPorcelain,
  workspaceListText,
  workspacePathPorcelain,
  workspacePathText,
  workspaceRemovePorcelain,
  workspaceRemoveText,
  workspaceSyncPorcelain,
  workspaceSyncText,
} from "../../../../lib/render/formatters/workspace";

const baseCtx = {
  colorEnabled: false,
  unicodeEnabled: true,
  isTTY: false,
  isStderrTTY: false,
};

describe("workspaceAdd", () => {
  it("text: confirms creation with path", () => {
    const out = workspaceAddText({ name: "ai", path: "/home/x/grove-workspaces/ai" }, baseCtx);
    expect(out).toBe("Created workspace 'ai' at /home/x/grove-workspaces/ai");
  });

  it("porcelain: name<TAB>created<TAB>path", () => {
    const out = workspaceAddPorcelain({ name: "ai", path: "/home/x/grove-workspaces/ai" });
    expect(out).toBe("ai\tcreated\t/home/x/grove-workspaces/ai");
  });
});

describe("workspaceList", () => {
  it("text TTY: aligned columns with header", () => {
    const out = workspaceListText(
      [
        { name: "ai", path: "/home/x/grove-workspaces/ai" },
        { name: "demo", path: "/home/x/grove-workspaces/demo" },
      ],
      { ...baseCtx, isTTY: true },
    );
    expect(out).toBe(
      "NAME  PATH\nai    /home/x/grove-workspaces/ai\ndemo  /home/x/grove-workspaces/demo",
    );
  });

  it("text non-TTY: aligned columns, no header", () => {
    const out = workspaceListText(
      [
        { name: "ai", path: "/x/ai" },
        { name: "demo", path: "/x/demo" },
      ],
      baseCtx,
    );
    expect(out).toBe("ai    /x/ai\ndemo  /x/demo");
  });

  it("text empty list: empty string", () => {
    expect(workspaceListText([], baseCtx)).toBe("");
  });

  it("porcelain: name<TAB>path per line", () => {
    expect(
      workspaceListPorcelain([
        { name: "a", path: "/x" },
        { name: "b", path: "/y" },
      ]),
    ).toBe("a\t/x\nb\t/y");
  });
});

describe("workspaceRemove", () => {
  it("text", () => {
    expect(workspaceRemoveText({ name: "demo" }, baseCtx)).toBe("Removed workspace 'demo'");
  });
  it("porcelain", () => {
    expect(workspaceRemovePorcelain({ name: "demo" })).toBe("demo\tremoved");
  });
});

describe("workspacePath", () => {
  it("text: path on its own line", () => {
    expect(workspacePathText({ path: "/home/x/grove-workspaces/ai" }, baseCtx)).toBe(
      "/home/x/grove-workspaces/ai",
    );
  });
  it("porcelain: same as text", () => {
    expect(workspacePathPorcelain({ path: "/home/x/grove-workspaces/ai" })).toBe(
      "/home/x/grove-workspaces/ai",
    );
  });
});

describe("workspaceSync", () => {
  it("text: summary with counts and dangling repo names", () => {
    const out = workspaceSyncText(
      {
        name: "ai",
        repos: [
          { name: "grove", status: "ok" },
          { name: "web", status: "repaired" },
          { name: "api", status: "dangling" },
        ],
      },
      baseCtx,
    );
    expect(out).toBe("Synced workspace 'ai': 1 ok, 1 repaired (web), 1 dangling (api)");
  });

  it("text: only ok results", () => {
    const out = workspaceSyncText(
      { name: "ai", repos: [{ name: "grove", status: "ok" }] },
      baseCtx,
    );
    expect(out).toBe("Synced workspace 'ai': 1 ok");
  });

  it("porcelain: workspace<TAB>repo<TAB>status per row", () => {
    const out = workspaceSyncPorcelain({
      name: "ai",
      repos: [
        { name: "grove", status: "ok" },
        { name: "api", status: "dangling" },
      ],
    });
    expect(out).toBe("ai\tgrove\tok\nai\tapi\tdangling");
  });
});
