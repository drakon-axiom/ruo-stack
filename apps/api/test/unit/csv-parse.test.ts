import { describe, expect, it } from 'vitest';
import { CsvParseError, buildCsv, csvCell, detectDelimiter, parseCsv } from '@ruostack/shared';

/**
 * The CSV reader behind the catalog importer. It is hand-rolled rather than a
 * dependency, so these tests ARE the correctness argument — every quoting and
 * line-ending case a spreadsheet can emit is pinned here.
 */
describe('parseCsv', () => {
  it('splits a plain header and rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual({
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('treats a trailing newline as end-of-file, not as an extra blank row', () => {
    // Every editor adds one. Without this, a 3-row file imports as 4 rows with
    // a blank SKU and reports a phantom error.
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']]);
  });

  it('skips blank lines anywhere in the file', () => {
    expect(parseCsv('a,b\n\n1,2\n\n\n3,4\n\n').rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps commas that are inside quotes', () => {
    expect(parseCsv('a,b\n"one, two",3').rows).toEqual([['one, two', '3']]);
  });

  it('keeps newlines that are inside quotes', () => {
    expect(parseCsv('a,b\n"line one\nline two",3').rows).toEqual([['line one\nline two', '3']]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseCsv('a\n"he said ""hi"""').rows).toEqual([['he said "hi"']]);
  });

  it('reads an empty quoted field as an empty string', () => {
    expect(parseCsv('a,b\n"",3').rows).toEqual([['', '3']]);
  });

  it('handles CRLF line endings', () => {
    // Excel on Windows writes these; a naive split on \n leaves a trailing \r
    // on every last cell, so "12.50\r" would fail price parsing.
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] });
  });

  it('handles lone CR line endings', () => {
    expect(parseCsv('a,b\r1,2').rows).toEqual([['1', '2']]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    // "Save as CSV UTF-8" in Excel always emits one. Without stripping it the
    // first column header never matches and every import fails on the SKU column.
    expect(parseCsv('﻿canonical_sku,name\nX,Y').header).toEqual(['canonical_sku', 'name']);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('returns nothing for a whitespace-only file', () => {
    expect(parseCsv('\n\n  \n')).toEqual({ header: [], rows: [] });
  });

  it('returns a header and no rows for a header-only file', () => {
    expect(parseCsv('a,b,c')).toEqual({ header: ['a', 'b', 'c'], rows: [] });
  });

  it('preserves a short row verbatim rather than padding it', () => {
    // Classification decides what a missing trailing cell means; the parser
    // must not invent empty strings that look like deliberate blanks.
    expect(parseCsv('a,b,c\n1,2').rows).toEqual([['1', '2']]);
  });

  it('preserves a long row verbatim rather than truncating it', () => {
    // An unquoted comma in a description shifts every later field by one. The
    // extra cell has to survive so the classifier can reject the row.
    expect(parseCsv('a,b\n1,2,3').rows).toEqual([['1', '2', '3']]);
  });

  it('throws with the line number when a quote is never closed', () => {
    try {
      parseCsv('a,b\n1,"unterminated\n3,4');
      throw new Error('expected parseCsv to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CsvParseError);
      expect((e as CsvParseError).line).toBe(2);
    }
  });

  it('throws when a quoted field is followed by stray characters', () => {
    expect(() => parseCsv('a\n"quoted"junk')).toThrow(CsvParseError);
  });
});

describe('detectDelimiter', () => {
  it('detects a comma', () => {
    expect(detectDelimiter('a,b,c')).toBe(',');
  });

  it('detects a semicolon', () => {
    // European Excel exports these. We reject rather than auto-switch, but the
    // error message has to name what it actually found.
    expect(detectDelimiter('a;b;c')).toBe(';');
  });

  it('detects a tab', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it('ignores delimiters that sit inside quotes', () => {
    expect(detectDelimiter('"a;b",c')).toBe(',');
  });

  it('returns null for a single-column header', () => {
    expect(detectDelimiter('canonical_sku')).toBeNull();
  });
});

describe('buildCsv / csvCell', () => {
  it('quotes only the cells that need it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has, comma')).toBe('"has, comma"');
    expect(csvCell('has "quote"')).toBe('"has ""quote"""');
    expect(csvCell('has\nnewline')).toBe('"has\nnewline"');
  });

  it('renders null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('round-trips through parseCsv', () => {
    const csv = buildCsv(['sku', 'note'], [['A-1', 'a, "quoted", note']]);
    expect(parseCsv(csv)).toEqual({ header: ['sku', 'note'], rows: [['A-1', 'a, "quoted", note']] });
  });
});
