/** A single day cell in a month grid. `inMonth` is false for leading/trailing padding days. */
export interface MonthGridCell {
  date: string;
  inMonth: boolean;
}

/** Builds a 7-column, week-row grid for the given month (0-11), padded with adjacent-month days. */
export function buildMonthGrid(year: number, month: number): MonthGridCell[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const startDay = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: MonthGridCell[] = [];

  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1, prevMonthDays - i));
    cells.push({ date: d.toISOString().slice(0, 10), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      date: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10),
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) {
    const last = new Date(`${cells[cells.length - 1].date}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + 1);
    cells.push({ date: last.toISOString().slice(0, 10), inMonth: false });
  }

  const weeks: MonthGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
