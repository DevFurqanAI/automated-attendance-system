/**
 * Minimal RFC 4180 CSV parsing — the read-side counterpart to the
 * escaping in src/lib/attendance/report.ts's csvCell(). Handles quoted
 * fields (including embedded commas and escaped `""`), CRLF and LF line
 * endings, and a trailing blank line. Not a general-purpose parser — built
 * for the one thing this app needs it for: reading back a small
 * employee-invite CSV a person exported from a spreadsheet.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // Handled by the following \n, or ignored if this is a lone \r.
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }

  // Final field/row, unless the file ended cleanly on a newline.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
