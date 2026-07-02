import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
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
    const info = await stat(this.journalPath).catch(() => null);
    if (!info || info.size <= max) {
      return;
    }
    // Fold the active journal into the archive (journal.1.jsonl) rather than
    // overwriting it, so a blob referenced only by an earlier rotation is
    // never orphaned by a later one. This keeps exactly two files on disk
    // (journal.jsonl + journal.1.jsonl) while never dropping history that
    // pruneObjects still considers live.
    const rotated = join(this.stateDir, "journal.1.jsonl");
    const current = await readFile(this.journalPath, "utf-8");
    const archive = await readFile(rotated, "utf-8").catch(() => "");
    await writeFile(rotated, archive + current);
    await unlink(this.journalPath);
    await this.pruneObjects();
  }

  /** Delete blobs unreferenced by any retained journal segment. */
  private async pruneObjects(): Promise<void> {
    const referenced = new Set<string>();
    for (const name of ["journal.jsonl", "journal.1.jsonl"]) {
      const text = await readFile(join(this.stateDir, name), "utf-8").catch(() => "");
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
