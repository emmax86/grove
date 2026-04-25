import { chars } from "./ascii";

export interface RenderTreeOpts {
  unicode: boolean;
}

export function renderTree<T>(
  root: T,
  getChildren: (n: T) => T[],
  label: (n: T) => string,
  opts: RenderTreeOpts,
): string {
  const { branch, lastBranch, vertical } = chars(opts.unicode);
  const indent = "    ";
  const continuation = `${vertical}   `;

  const lines: string[] = [label(root)];

  const walk = (node: T, prefix: string): void => {
    const children = getChildren(node);
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      const connector = isLast ? lastBranch : branch;
      lines.push(`${prefix}${connector} ${label(child)}`);
      walk(child, prefix + (isLast ? indent : continuation));
    });
  };

  walk(root, "");
  return lines.join("\n");
}
