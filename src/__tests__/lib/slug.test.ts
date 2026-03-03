import { describe, expect, it } from "bun:test";

import { toSlug } from "../../lib/slug";

describe("toSlug", () => {
  it("leaves plain names unchanged", () => {
    expect(toSlug("main")).toBe("main");
    expect(toSlug("master")).toBe("master");
    expect(toSlug("develop")).toBe("develop");
  });

  it("converts slashes to dashes", () => {
    expect(toSlug("feature/auth")).toBe("feature-auth");
  });

  it("handles deeply nested branches", () => {
    expect(toSlug("feature/deep/nested")).toBe("feature-deep-nested");
  });

  it("preserves dots and other valid chars", () => {
    expect(toSlug("hotfix/v1.2.3")).toBe("hotfix-v1.2.3");
  });

  it("handles empty string", () => {
    expect(toSlug("")).toBe("");
  });
});
