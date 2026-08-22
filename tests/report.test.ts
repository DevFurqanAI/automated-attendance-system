import { describe, expect, it } from 'vitest';
import { toCsv, type ReportEntry } from '@/lib/attendance/report';

const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  id: 'a',
  employeeName: 'Ada Lovelace',
  employeeEmail: 'ada@example.com',
  branchName: 'Downtown Branch',
  method: 'qr_gps',
  checkInTime: '2026-08-22T09:00:00.000Z',
  checkOutTime: '2026-08-22T17:30:00.000Z',
  hours: 8.5,
  remoteReason: null,
  ...over,
});

describe('toCsv', () => {
  it('writes a header row and one row per entry', () => {
    const csv = toCsv([entry(), entry({ id: 'b' })]);
    const lines = csv.trim().split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'Employee,Email,Branch,Method,Check in,Check out,Hours worked,Remote reason',
    );
    expect(lines[1]).toContain('Ada Lovelace');
    expect(lines[1]).toContain('8.50');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([
      entry({ employeeName: 'Doe, John', remoteReason: 'Said "hello"' }),
    ]);

    expect(csv).toContain('"Doe, John"');
    expect(csv).toContain('"Said ""hello"""');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A crafted remote reason must not execute when HR opens the CSV in Excel.
    const csv = toCsv([
      entry({ remoteReason: '=HYPERLINK("http://evil.test","click")' }),
    ]);

    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it.each(['+1', '-1+1', '@SUM(A1)'])(
    'escapes a leading %s',
    (value) => {
      const csv = toCsv([entry({ remoteReason: value })]);
      expect(csv).toContain(`'${value}`);
    },
  );

  it('renders an open shift as an empty hours cell rather than zero', () => {
    const csv = toCsv([entry({ checkOutTime: null, hours: null })]);
    const row = csv.trim().split('\r\n')[1];

    // Trailing empty fields for check-out, hours, and reason.
    expect(row.endsWith(',,,')).toBe(true);
  });

  it('labels an approved remote entry distinctly from a QR one', () => {
    const csv = toCsv([entry({ method: 'remote_request' })]);
    expect(csv).toContain('Remote (approved)');
  });
});
