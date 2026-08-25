import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('splits simple comma-separated rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('"Doe, Jane",jane@example.com')).toEqual([
      ['Doe, Jane', 'jane@example.com'],
    ]);
  });

  it('handles escaped quotes inside a quoted field', () => {
    expect(parseCsv('"She said ""hi""",x')).toEqual([['She said "hi"', 'x']]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\nc,d\n\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
