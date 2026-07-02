import type { TouchStatus } from "./context-state";

/**
 * In-memory per-session served-state. This is the AUTHORITY for disclosure
 * decisions; it is deliberately not persisted — a fresh ledger (session
 * reconnect, daemon restart) re-serves, which is the safe failure direction.
 */
export class ContextLedger {
  private readonly served = new Map<string, string>();

  constructor(public sessionKey: string) {}

  classify(contextKey: string, contentHash: string, refresh: boolean): TouchStatus {
    const existing = this.served.get(contextKey);
    if (refresh) {
      return existing !== undefined ? "refreshed" : "served";
    }
    if (existing === undefined) {
      return "served";
    }
    return existing === contentHash ? "current" : "updated";
  }

  record(contextKey: string, contentHash: string): void {
    this.served.set(contextKey, contentHash);
  }

  entries(): { contextKey: string; contentHash: string }[] {
    return Array.from(this.served, ([contextKey, contentHash]) => ({ contextKey, contentHash }));
  }
}
