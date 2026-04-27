export type HelpNode = HelpGroup | HelpLeaf;

export interface HelpNodeBase {
  /** Canonical token in argv. */
  name: string;
  /** Optional aliases shown inline in parent's help; also accepted by dispatch. */
  aliases?: readonly string[];
  /** One-line summary shown in parent's command table. */
  summary: string;
  /** Multi-line description shown only on this node's own --help. */
  description?: string;
}

export interface HelpGroup extends HelpNodeBase {
  kind: "group";
  children: readonly HelpNode[];
}

export interface HelpLeaf extends HelpNodeBase {
  kind: "leaf";
  args?: readonly HelpArg[];
  flags?: readonly HelpFlag[];
  examples?: readonly HelpExample[];
}

export interface HelpArg {
  name: string;
  required: boolean;
  summary?: string;
  /** Documentation only — what the optional arg falls back to when omitted. */
  defaultFrom?: "context-workspace" | "context-repo";
}

export interface HelpFlag {
  /** Flag name without leading dashes. */
  name: string;
  /** Present = takes a value; absent = boolean. */
  valueLabel?: string;
  summary: string;
  /** Shown in description: "(also $GROVE_WORKSPACE)". */
  envVar?: string;
}

export interface HelpExample {
  /** Verbatim command line; must start with "grove ". */
  command: string;
  /** Optional one-line explanation rendered above the command. */
  description?: string;
}

const WORKSPACE_FLAG: HelpFlag = {
  name: "workspace",
  valueLabel: "<name>",
  summary: "workspace name (defaults to inferred from CWD)",
  envVar: "GROVE_WORKSPACE",
};

export const GLOBAL_FLAGS: readonly HelpFlag[] = [
  { name: "json", summary: "JSON output ({ok, data} envelope)" },
  { name: "porcelain", summary: "tab-separated output, one row per result" },
  { name: "text", summary: "human-readable output (default)" },
  { name: "no-color", summary: "disable ANSI color" },
  { name: "ascii", summary: "use ASCII tree characters (also LANG=C)" },
];

const WS_GROUP: HelpGroup = {
  kind: "group",
  name: "ws",
  aliases: ["workspaces"],
  summary: "manage workspaces, repos, and worktrees",
  children: [
    {
      kind: "leaf",
      name: "add",
      summary: "create a workspace",
      args: [{ name: "name", required: true, summary: "workspace name" }],
    },
    {
      kind: "leaf",
      name: "list",
      summary: "list workspaces",
    },
    {
      kind: "leaf",
      name: "remove",
      summary: "remove a workspace",
      args: [
        {
          name: "name",
          required: false,
          defaultFrom: "context-workspace",
          summary: "workspace name (defaults to inferred)",
        },
      ],
      flags: [{ name: "force", summary: "remove without confirmation" }, WORKSPACE_FLAG],
    },
    {
      kind: "leaf",
      name: "status",
      summary: "show repos and worktrees overview",
      args: [{ name: "workspace", required: false, defaultFrom: "context-workspace" }],
      flags: [WORKSPACE_FLAG],
    },
    {
      kind: "leaf",
      name: "path",
      summary: "print workspace directory path",
      args: [{ name: "workspace", required: false, defaultFrom: "context-workspace" }],
      flags: [WORKSPACE_FLAG],
    },
    {
      kind: "leaf",
      name: "sync",
      summary: "repair symlinks and prune dangling entries",
      args: [{ name: "workspace", required: false, defaultFrom: "context-workspace" }],
      flags: [WORKSPACE_FLAG],
    },
    {
      kind: "group",
      name: "repo",
      summary: "manage registered git repos",
      children: [
        {
          kind: "leaf",
          name: "add",
          summary: "register a git repo in a workspace",
          args: [
            { name: "workspace", required: false, defaultFrom: "context-workspace" },
            { name: "path", required: true, summary: "absolute path to the git repo" },
          ],
          flags: [
            {
              name: "name",
              valueLabel: "<override>",
              summary: "override the repo name (default: directory name)",
            },
            WORKSPACE_FLAG,
          ],
          examples: [
            {
              command: "grove ws repo add ~/code/my-api",
              description: "Register ~/code/my-api in the workspace inferred from CWD",
            },
          ],
        },
        {
          kind: "leaf",
          name: "list",
          summary: "list repos registered in a workspace",
          args: [{ name: "workspace", required: false, defaultFrom: "context-workspace" }],
          flags: [WORKSPACE_FLAG],
        },
        {
          kind: "leaf",
          name: "remove",
          summary: "unregister a repo from a workspace",
          args: [
            { name: "workspace", required: false, defaultFrom: "context-workspace" },
            { name: "name", required: true, summary: "registered repo name" },
          ],
          flags: [{ name: "force", summary: "remove even if worktrees exist" }, WORKSPACE_FLAG],
        },
      ],
    },
    {
      kind: "group",
      name: "worktree",
      summary: "manage git worktrees in the shared pool",
      children: [
        {
          kind: "leaf",
          name: "add",
          summary: "create a worktree in the shared pool",
          args: [
            { name: "repo", required: false, defaultFrom: "context-repo" },
            { name: "branch", required: true, summary: "branch name to check out" },
          ],
          flags: [
            { name: "new", summary: "create the branch if it doesn't exist" },
            {
              name: "from",
              valueLabel: "<base>",
              summary: "base branch to fork from (default: default branch)",
            },
            { name: "no-setup", summary: "skip the post-create setup hook" },
            WORKSPACE_FLAG,
          ],
          examples: [
            {
              command: "grove ws worktree add my-api feat-auth --new",
              description: "Create branch feat-auth in my-api and check it out",
            },
            {
              command: "grove ws worktree add --workspace myproject my-api hotfix --from main",
              description: "Worktree for existing branch hotfix, forked from main",
            },
          ],
        },
        {
          kind: "leaf",
          name: "list",
          summary: "list worktrees for a repo",
          args: [{ name: "repo", required: false, defaultFrom: "context-repo" }],
          flags: [WORKSPACE_FLAG],
        },
        {
          kind: "leaf",
          name: "remove",
          summary: "remove a worktree",
          args: [
            { name: "repo", required: false, defaultFrom: "context-repo" },
            { name: "slug", required: true, summary: "worktree slug" },
          ],
          flags: [
            { name: "force", summary: "remove even with uncommitted changes" },
            WORKSPACE_FLAG,
          ],
        },
        {
          kind: "leaf",
          name: "prune",
          summary: "remove dangling worktree symlinks",
          flags: [WORKSPACE_FLAG],
        },
      ],
    },
    {
      kind: "leaf",
      name: "exec",
      summary: "run standard commands against a repo",
      args: [
        {
          name: "command",
          required: true,
          summary: "one of: setup, format, test, check, test:file, test:match",
        },
        { name: "file", required: false, summary: "file path (required for test:file)" },
      ],
      flags: [
        { name: "match", valueLabel: "<pattern>", summary: "filter pattern for test:match" },
        {
          name: "repo",
          valueLabel: "<name>",
          summary: "repo name (inferred from file path if file given)",
        },
        { name: "dry-run", summary: "print resolved command without running" },
        WORKSPACE_FLAG,
      ],
      examples: [
        {
          command: "grove ws exec test --repo my-api",
          description: "Run the full test suite for my-api",
        },
        {
          command: "grove ws exec test:file src/foo.test.ts",
          description: "Run a single test file (repo inferred from path)",
        },
      ],
    },
  ],
};

const MCP_SERVER_LEAF: HelpLeaf = {
  kind: "leaf",
  name: "mcp-server",
  summary: "run the MCP server for a workspace",
  flags: [
    WORKSPACE_FLAG,
    {
      name: "port",
      valueLabel: "<port>",
      summary: "port to listen on (default: random free port)",
    },
  ],
};

export const REGISTRY: HelpGroup = {
  kind: "group",
  name: "grove",
  summary: "manage named workspaces of git repos and worktrees",
  children: [WS_GROUP, MCP_SERVER_LEAF],
};
