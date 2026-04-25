import { stripAnsi } from "./color";

export interface AlignTableOpts {
  headers?: string[];
  gap?: number;
}

export function alignTable(rows: string[][], opts: AlignTableOpts = {}): string {
  if (rows.length === 0 && !opts.headers) {
    return "";
  }
  const allRows = opts.headers ? [opts.headers, ...rows] : rows;
  const gap = opts.gap ?? 2;

  const numCols = Math.max(...allRows.map((r) => r.length));
  const widths: number[] = [];
  for (let col = 0; col < numCols; col++) {
    widths[col] = Math.max(...allRows.map((r) => stripAnsi(r[col] ?? "").length));
  }

  return allRows
    .map((row) =>
      row
        .map((cell, col) =>
          col === row.length - 1
            ? cell
            : cell.padEnd(widths[col] + gap + (cell.length - stripAnsi(cell).length)),
        )
        .join("")
        .trimEnd(),
    )
    .join("\n");
}
