import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type DisclosureEvent, DisclosureRecorder } from "../../lib/context-state";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "grove-state-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function event(overrides: Partial<DisclosureEvent> = {}): DisclosureEvent {
  return {
    ts: "2026-07-01T00:00:00.000Z",
    session: "s1",
    trigger: "mcp",
    contextKey: "ai/grove/main",
    contentHash: "abc123",
    action: "served",
    ...overrides,
  };
}

describe("DisclosureRecorder", () => {
  it("creates the state dir with a self-ignoring .gitignore on first record", async () => {
    const recorder = new DisclosureRecorder(join(dir, "state", "context"));
    await recorder.record(event());
    const ignore = await readFile(join(dir, "state", "context", ".gitignore"), "utf-8");
    expect(ignore).toBe("*\n");
  });

  it("appends one JSONL line per event", async () => {
    const recorder = new DisclosureRecorder(join(dir, "ctx"));
    await recorder.record(event());
    await recorder.record(event({ action: "current", ts: "2026-07-01T00:00:01.000Z" }));
    const lines = (await readFile(join(dir, "ctx", "journal.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].action).toBe("served");
    expect(lines[1].action).toBe("current");
  });

  it("stores content in the blob store keyed by hash, write-once", async () => {
    const recorder = new DisclosureRecorder(join(dir, "ctx"));
    await recorder.record(event(), "instruction body");
    await recorder.record(event(), "instruction body"); // same hash — no rewrite, no error
    const objects = await readdir(join(dir, "ctx", "objects"));
    expect(objects).toEqual(["abc123"]);
    expect(await readFile(join(dir, "ctx", "objects", "abc123"), "utf-8")).toBe("instruction body");
  });

  it("does not write a blob for content-less events", async () => {
    const recorder = new DisclosureRecorder(join(dir, "ctx"));
    await recorder.record(event({ action: "current" }));
    await expect(readdir(join(dir, "ctx", "objects"))).resolves.toEqual([]);
  });

  it("evicts the oldest segment's blobs once they fall past the ring", async () => {
    const recorder = new DisclosureRecorder(join(dir, "ctx"), {
      maxJournalBytes: 200,
      maxSegments: 2,
    });
    await recorder.record(event({ contentHash: "old1" }), "old content");
    for (let i = 0; i < 5; i++) {
      await recorder.record(event({ contentHash: `new${i}`, ts: `2026-07-01T00:00:0${i}Z` }), "x");
    }
    const files = await readdir(join(dir, "ctx"));
    expect(files).toContain("journal.1.jsonl"); // rotation occurred
    const objects = await readdir(join(dir, "ctx", "objects"));
    expect(objects).not.toContain("old1"); // evicted past the 2-segment ring
    expect(objects.some((o) => o.startsWith("new"))).toBe(true); // a still-referenced blob survives
  });

  it("retains an old blob while its segment is still within the ring", async () => {
    const recorder = new DisclosureRecorder(join(dir, "ctx2"), {
      maxJournalBytes: 200,
      maxSegments: 5,
    });
    await recorder.record(event({ contentHash: "old1" }), "old content");
    for (let i = 0; i < 5; i++) {
      await recorder.record(event({ contentHash: `new${i}`, ts: `2026-07-01T00:00:0${i}Z` }), "x");
    }
    const objects = await readdir(join(dir, "ctx2", "objects"));
    expect(objects).toContain("old1"); // still within the 5-segment ring
  });

  it("never throws when the state dir is unwritable (observation must not break serving)", async () => {
    const recorder = new DisclosureRecorder("/proc/definitely/not/writable");
    await expect(recorder.record(event())).resolves.toBeUndefined();
  });
});
