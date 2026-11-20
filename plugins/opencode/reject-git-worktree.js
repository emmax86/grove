import { spawn } from "node:child_process";

const SHELL_TOOLS = new Set(["bash", "shell"]);
const HOOK_TIMEOUT_MS = 5000;

export async function resolveEventDirectory(ctx, event) {
  if (typeof event?.directory === "string" && event.directory.length > 0) {
    return event.directory;
  }

  if (typeof event?.sessionID === "string" && event.sessionID.length > 0) {
    if (typeof ctx?.session?.get !== "function") {
      return undefined;
    }

    try {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const sessionDir = session?.directory ?? session?.location?.directory;
      return typeof sessionDir === "string" && sessionDir.length > 0 ? sessionDir : undefined;
    } catch {
      return undefined;
    }
  }

  const fallbackDir = ctx?.location?.directory ?? ctx?.directory;
  return typeof fallbackDir === "string" && fallbackDir.length > 0 ? fallbackDir : undefined;
}

function runGroveHook(command, payload, env) {
  return new Promise((resolve) => {
    const [bin, ...baseArgs] = command;
    let settled = false;
    const finish = (stdout) => {
      if (!settled) {
        settled = true;
        resolve(stdout);
      }
    };

    let child;
    try {
      child = spawn(bin, [...baseArgs, "hook", "reject-git-worktree", "--host", "opencode"], {
        env,
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      finish("");
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish("");
    }, HOOK_TIMEOUT_MS);

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish("");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? stdout : "");
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createRejectGitWorktreeHook({
  ctx,
  directory,
  groveCommand = ["grove"],
  env = process.env,
} = {}) {
  return async (event) => {
    if (!event || typeof event.tool !== "string" || !SHELL_TOOLS.has(event.tool)) {
      return;
    }

    const eventDirectory = ctx
      ? await resolveEventDirectory(ctx, event)
      : typeof event.directory === "string" && event.directory.length > 0
        ? event.directory
        : directory;

    const stdout = await runGroveHook(
      groveCommand,
      {
        tool: event.tool,
        input: event.input,
        args: event.args,
        directory: eventDirectory,
      },
      env,
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      return;
    }

    let decision;
    try {
      decision = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (decision?.decision === "deny" && typeof decision.reason === "string") {
      throw new Error(decision.reason);
    }
  };
}
