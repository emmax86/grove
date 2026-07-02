import { describe, expect, it } from "bun:test";

import { ContextLedger } from "../../lib/context-ledger";

describe("ContextLedger", () => {
  it("classifies an unseen scope as served", () => {
    const ledger = new ContextLedger("s1");
    expect(ledger.classify("ai/grove/main", "aaa", false)).toBe("served");
  });

  it("classifies a recorded scope with the same hash as current", () => {
    const ledger = new ContextLedger("s1");
    ledger.record("ai/grove/main", "aaa");
    expect(ledger.classify("ai/grove/main", "aaa", false)).toBe("current");
  });

  it("classifies a recorded scope with a different hash as updated", () => {
    const ledger = new ContextLedger("s1");
    ledger.record("ai/grove/main", "aaa");
    expect(ledger.classify("ai/grove/main", "bbb", false)).toBe("updated");
  });

  it("refresh bypasses the ledger: refreshed when seen, served when unseen", () => {
    const ledger = new ContextLedger("s1");
    ledger.record("ai/grove/main", "aaa");
    expect(ledger.classify("ai/grove/main", "aaa", true)).toBe("refreshed");
    expect(ledger.classify("ai/other", "ccc", true)).toBe("served");
  });

  it("classify never mutates; record is explicit", () => {
    const ledger = new ContextLedger("s1");
    ledger.classify("ai/grove/main", "aaa", false);
    expect(ledger.classify("ai/grove/main", "aaa", false)).toBe("served");
    ledger.record("ai/grove/main", "aaa");
    expect(ledger.entries()).toEqual([{ contextKey: "ai/grove/main", contentHash: "aaa" }]);
  });
});
