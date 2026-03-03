---
description: Show status overview for the current grove workspace (repos and worktrees)
argument-hint: "[workspace]"
allowed-tools: Bash(grove ws status:*)
---

Run grove workspace status:

```
grove ws status $ARGUMENTS
```

The workspace is inferred from `$PWD` when no argument is given.

Show the results in a readable format: list each repo with its path and status, then list its worktrees (slug, branch, type). If the command fails, show the error.
