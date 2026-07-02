import { describe, expect, it } from "bun:test";

import type { ContextSessionsValue } from "../../../../commands/context-client";
import {
  contextSessionsPorcelain,
  contextSessionsText,
} from "../../../../lib/render/formatters/context";

describe("contextSessionsText", () => {
  it("renders 'none' when there are no active sessions", () => {
    const value: ContextSessionsValue = { workspace: "ai", sessions: [] };
    expect(contextSessionsText(value)).toContain("none");
  });

  it("renders a table of session / scopes / hashes", () => {
    const value: ContextSessionsValue = {
      workspace: "ai",
      sessions: [
        {
          session: "s1",
          scopes: [
            { contextKey: "ai/grove/main", contentHash: "aaaa1111aaaa" },
            { contextKey: "ai/grove/main/src", contentHash: "bbbb2222bbbb" },
          ],
        },
      ],
    };
    const text = contextSessionsText(value);
    expect(text).toContain("s1");
    expect(text).toContain("ai/grove/main@aaaa1111");
    expect(text).toContain("ai/grove/main/src@bbbb2222");
  });
});

describe("contextSessionsPorcelain", () => {
  it("renders one row per session scope", () => {
    const value: ContextSessionsValue = {
      workspace: "ai",
      sessions: [
        {
          session: "s1",
          scopes: [{ contextKey: "ai/grove/main", contentHash: "aaaa1111aaaa" }],
        },
      ],
    };
    expect(contextSessionsPorcelain(value)).toBe(
      ["session", "ai", "s1", "ai/grove/main", "aaaa1111aaaa"].join("\t"),
    );
  });

  it("renders empty string when there are no sessions", () => {
    expect(contextSessionsPorcelain({ workspace: "ai", sessions: [] })).toBe("");
  });
});
