import { describe, expect, it } from "bun:test";

import { AsyncMutex } from "../../lib/mutex";

describe("AsyncMutex", () => {
  it("acquires and releases without contention", async () => {
    const mutex = new AsyncMutex();
    await mutex.acquire();
    mutex.release();
    // If we get here without hanging, the test passes
    expect(true).toBe(true);
  });

  it("second acquire waits until first is released", async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    await mutex.acquire();

    const second = mutex.acquire().then(() => {
      order.push(2);
      mutex.release();
    });

    order.push(1);
    mutex.release();

    await second;
    expect(order).toEqual([1, 2]);
  });

  it("serializes three concurrent acquires in FIFO order", async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    await mutex.acquire();

    const promises = [1, 2, 3].map((n) =>
      mutex.acquire().then(() => {
        order.push(n);
        mutex.release();
      }),
    );

    mutex.release();
    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3]);
  });

  it("run() acquires, executes, and releases automatically", async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.run(async () => 42);
    expect(result).toBe(42);

    // Should be releasable again after run()
    await mutex.acquire();
    mutex.release();
  });

  it("run() releases even when the callback throws", async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Mutex must be unlocked after error
    const acquired = await Promise.race([
      mutex.acquire().then(() => "acquired"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);
    expect(acquired).toBe("acquired");
    mutex.release();
  });

  it("nested run() calls are serialized", async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];

    await Promise.all([
      mutex.run(async () => {
        log.push("a-start");
        await new Promise((r) => setTimeout(r, 10));
        log.push("a-end");
      }),
      mutex.run(async () => {
        log.push("b-start");
        log.push("b-end");
      }),
    ]);

    expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});
