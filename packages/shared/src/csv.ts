/**
 * A small RFC-4180-subset CSV reader/writer, hand-rolled rather than pulled in
 * as a dependency: `@ruostack/shared` is imported by both web apps and ships to
 * the browser, its only runtime dep is zod, and the repo already hand-rolls CSV
 * *output* (services/store-provision.ts, services/ledger.ts). This is the
 * symmetric half. Its correctness argument is test/unit/csv-parse.test.ts.
 *
 * Deliberately delimiter-agnostic internally but only ever driven with a comma:
 * `detectDelimiter` exists so a semicolon file gets a useful error, NOT so we
 * can silently reinterpret the operator's file.
 */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/** A file-level parse failure. `line` is 1-based and physical (as an editor shows it). */
export class CsvParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = 'CsvParseError';
    this.line = line;
  }
}

const BOM = '﻿';

/**
 * Parse CSV text into a header row plus data rows. Rows are returned VERBATIM —
 * short and long rows are preserved rather than padded or truncated, because
 * what a ragged row means is a classification decision, not a parsing one.
 * Blank lines are skipped anywhere in the file.
 */
export function parseCsv(text: string, delimiter = ','): ParsedCsv {
  const src = text.startsWith(BOM) ? text.slice(1) : text;

  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false; // currently inside a quoted field
  let hadQuotes = false; // this field was quoted (so nothing may follow the close)
  let line = 1;
  let quoteStartLine = 1;

  const endField = (): void => {
    row.push(field);
    field = '';
    hadQuotes = false;
  };
  const endRow = (): void => {
    endField();
    // A line that holds nothing but whitespace is a blank line, not a data row.
    if (row.length > 1 || (row[0] ?? '').trim() !== '') records.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
        continue;
      }
      // Normalize embedded line endings so a Windows-authored description does
      // not carry stray \r into the database.
      if (ch === '\r') {
        if (src[i + 1] === '\n') i++;
        field += '\n';
        line++;
        continue;
      }
      if (ch === '\n') {
        field += '\n';
        line++;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"' && field === '' && !hadQuotes) {
      quoted = true;
      hadQuotes = true;
      quoteStartLine = line;
      continue;
    }

    if (ch === delimiter) {
      endField();
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      continue;
    }

    if (hadQuotes) {
      throw new CsvParseError(
        `Unexpected text after a closing quote on line ${line}. Check for a stray quote character.`,
        line,
      );
    }
    field += ch;
  }

  if (quoted) {
    throw new CsvParseError(
      `A quoted value opened on line ${quoteStartLine} is never closed. Check for an unmatched " character.`,
      quoteStartLine,
    );
  }
  endRow();

  return { header: records[0] ?? [], rows: records.slice(1) };
}

/**
 * Which delimiter does this header line actually use? Used only to turn "no
 * recognisable columns" into an actionable message. Returns null when the line
 * holds no delimiter at all (a legitimate single-column file).
 */
export function detectDelimiter(headerLine: string): ',' | ';' | '\t' | null {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i]!;
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const best = (Object.keys(counts) as (',' | ';' | '\t')[]).reduce((a, b) =>
    (counts[b] ?? 0) > (counts[a] ?? 0) ? b : a,
  );
  return (counts[best] ?? 0) > 0 ? best : null;
}

/** Quote a value only when it needs it. */
export function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}
