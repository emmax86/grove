import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderErrorsMarkdown } from "../src/lib/errors";

const target = resolve(import.meta.dir, "..", "docs", "errors.md");
await writeFile(target, renderErrorsMarkdown());
console.log(`wrote ${target}`);
