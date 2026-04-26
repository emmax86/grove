export type ErrorEntry = {
  description: string;
  hint?: string;
};

export const ERROR_CATALOG = {
  // Workspace config
  CONFIG_NOT_FOUND: {
    description: "The workspace config file is missing.",
    hint: "Check that the workspace exists with `grove ws list`.",
  },
  CONFIG_INVALID: {
    description: "The workspace config file is malformed JSON or fails schema validation.",
  },
  CONFIG_WRITE_FAILED: {
    description: "Writing the workspace config file failed.",
  },

  // Pool config
  POOL_CONFIG_INVALID: {
    description: "The pool config file is malformed JSON or fails schema validation.",
  },
  POOL_CONFIG_WRITE_FAILED: {
    description: "Writing the pool config file failed.",
  },

  // Workspace lifecycle
  WORKSPACE_NOT_FOUND: {
    description: "The named workspace does not exist.",
  },
  WORKSPACE_EXISTS: {
    description: "A workspace with the given name already exists.",
  },

  // Repo lifecycle
  REPO_NOT_FOUND: {
    description: "The named repo is not registered in the workspace.",
  },
  REPO_NOT_RESOLVED: {
    description: "Could not determine which repo a command should target.",
    hint: "Pass --repo or invoke the command from inside a worktree.",
  },
  NOT_A_GIT_REPO: {
    description: "The path is not a git repository.",
  },

  // Worktree lifecycle
  WORKTREE_NOT_FOUND: {
    description: "The named worktree does not exist.",
  },
  WORKTREE_REMOVE_FAILED: {
    description: "Removing a worktree failed.",
  },

  // Git invocation
  GIT_DEFAULT_BRANCH_ERROR: {
    description: "Failed to determine the repo's default branch.",
  },
  GIT_WORKTREE_ADD_ERROR: {
    description: "`git worktree add` failed.",
  },
  GIT_WORKTREE_LIST_ERROR: {
    description: "`git worktree list` failed or returned malformed output.",
  },
  GIT_WORKTREE_REMOVE_ERROR: {
    description: "`git worktree remove` failed.",
  },

  // Filesystem and symlinks
  DANGLING_SYMLINK: {
    description: "A symlink points at a path that does not exist.",
  },
  SYMLINK_CREATE_FAILED: {
    description: "Creating a symlink failed.",
  },
  VSCODE_WORKSPACE_WRITE_FAILED: {
    description: "Writing the generated VS Code workspace file failed.",
  },

  // Naming and validation
  INVALID_NAME: {
    description: "A workspace, repo, or branch name failed validation.",
  },
  RESERVED_NAME: {
    description:
      "The supplied name conflicts with a reserved directory name (e.g. `repos`, `trees`, `worktrees`).",
  },

  // CLI
  UNKNOWN_COMMAND: {
    description: "The top-level command is not recognised.",
  },
  UNKNOWN_SUBCOMMAND: {
    description: "The subcommand is not recognised.",
  },
} as const satisfies Record<string, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
