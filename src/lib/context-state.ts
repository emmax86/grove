import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export type TouchStatus = "served" | "current" | "updated" | "refreshed";

export interface DisclosureEvent {
  ts: string;
  session: string;
  trigger: "mcp" | "cli";
  contextKey: string;
  contentHash: string;
  action: TouchStatus;
}

interface RecorderOptions {
  /** Rotate journal.jsonl when it exceeds this size. Default 5 MiB. */
  maxJournalBytes?: number;
  /** Total retained journal segments (active + archives). The oldest is evicted past this. Default 2. */
  maxSegments?: number;
}

/**
 * Write-through observability store: append-only journal + content-addressed
 * blob store. NEVER read on the serving path; every method swallows I/O
 * errors so a broken state dir cannot affect disclosure behavior.
 */
export class DisclosureRecorder {
  private initialized = false;

  constructor(
    private readonly stateDir: string,
    private readonly options: RecorderOptions = {},
  ) {}

  private get journalPath(): string {
    return join(this.stateDir, "journal.jsonl");
  }

  private get objectsDir(): string {
    return join(this.stateDir, "objects");
  }

  /** slot 0 -> journal.jsonl (active); slot i>=1 -> journal.<i>.jsonl (archive). */
  private segmentPath(i: number): string {
    return i === 0 ? this.journalPath : join(this.stateDir, `journal.${i}.jsonl`);
  }

  private async ensureStateDir(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await mkdir(this.objectsDir, { recursive: true });
    // Self-ignoring (uv-style): machine state never touches the user's
    // root .gitignore and never appears in git status.
    const gitignore = join(this.stateDir, ".gitignore");
    try {
      await stat(gitignore);
    } catch {
      await writeFile(gitignore, "*\n");
    }
    this.initialized = true;
  }

  async record(event: DisclosureEvent, content?: string): Promise<void> {
    try {
      await this.ensureStateDir();
      if (content !== undefined && event.action !== "current") {
        await this.putObject(event.contentHash, content);
      }
      await appendFile(this.journalPath, `${JSON.stringify(event)}\n`);
      await this.maybeRotate();
    } catch {
      // Observation-only: swallow. A broken journal must not break serving.
    }
  }

  private async putObject(hash: string, content: string): Promise<void> {
    const path = join(this.objectsDir, hash);
    try {
      await stat(path);
      return; // write-once: object already exists
    } catch {
      await writeFile(path, content);
    }
  }

  private async maybeRotate(): Promise<void> {
    const max = this.options.maxJournalBytes ?? 5 * 1024 * 1024;
    const maxSegments = this.options.maxSegments ?? 2;
    const info = await stat(this.journalPath).catch(() => null);
    if (!info || info.size <= max) {
      return;
    }
    // Bounded segment ring, drop-oldest: evict the oldest archive, shift the
    // remaining archives one slot older, then move the active journal into
    // slot 1. The next append recreates journal.jsonl. This keeps at most
    // maxSegments files on disk instead of growing the archive unboundedly.
    const oldest = maxSegments - 1;
    await unlink(this.segmentPath(oldest)).catch(() => {});
    for (let i = oldest - 1; i >= 1; i--) {
      await rename(this.segmentPath(i), this.segmentPath(i + 1)).catch(() => {});
    }
    await rename(this.journalPath, this.segmentPath(1));
    await this.pruneObjects(maxSegments);
  }

  /** Delete blobs unreferenced by any retained journal segment. */
  private async pruneObjects(maxSegments: number): Promise<void> {
    const referenced = new Set<string>();
    for (let i = 0; i < maxSegments; i++) {
      const text = await readFile(this.segmentPath(i), "utf-8").catch(() => "");
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as DisclosureEvent;
          referenced.add(parsed.contentHash);
        } catch {
          // skip corrupt line
        }
      }
    }
    const objects = await readdir(this.objectsDir).catch(() => [] as string[]);
    await Promise.all(
      objects
        .filter((o) => !referenced.has(o))
        .map((o) => unlink(join(this.objectsDir, o)).catch(() => {})),
    );
  }
}
