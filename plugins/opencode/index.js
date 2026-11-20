import { Plugin } from "@opencode/plugin";

import { createRejectGitWorktreeHook } from "./reject-git-worktree.js";

export default Plugin.define({
  id: "grove",
  async setup(ctx) {
    const directory = ctx.directory ?? ctx.location?.directory ?? process.cwd();
    const onBeforeExecute = createRejectGitWorktreeHook({ directory });
    await ctx.tool.hook("execute.before", onBeforeExecute);
  },
});
