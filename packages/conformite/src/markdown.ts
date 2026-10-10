/**
 * The registers are Markdown tables (ADR-0022): read here, strictly. A table
 * that does not parse — a row with too few or too many cells, a missing
 * header — fails loudly: a register that silently reads as empty would make
 * every check pass.
 */

export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableError";
  }
}

export type Row = Readonly<Record<string, string>>;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** The rows of the first table whose first header cell is `first`. */
export function table(markdown: string, first: string, where = "le document"): Row[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("|") && cells(l)[0] === first);
  if (start === -1) throw new TableError(`${where} : aucun tableau ne commence par « ${first} »`);
  const header = cells(lines[start] ?? "");
  if (!/^\|?\s*:?-{3,}/.test(lines[start + 1]?.trim() ?? "")) {
    throw new TableError(`${where} : le tableau « ${first} » n'a pas de ligne de séparation`);
  }
  const rows: Row[] = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith("|")) break;
    const values = cells(line);
    if (values.length !== header.length) {
      throw new TableError(
        `${where}, ligne ${i + 1} : ${values.length} cellules pour ${header.length} colonnes`,
      );
    }
    rows.push(Object.fromEntries(header.map((h, j) => [h, values[j] ?? ""])));
  }
  if (rows.length === 0) throw new TableError(`${where} : le tableau « ${first} » est vide`);
  return rows;
}
