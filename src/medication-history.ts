import type { Dose } from './domain.ts';

export type DoseSummary = { taken: number; total: number };

/** Summarize saved schedules by their local date, never inventing missing days. */
export function summarizeDosesByDate(doses: readonly Dose[], throughDate: string): Map<string, DoseSummary> {
  const summaries = new Map<string, DoseSummary>();
  for (const dose of doses) {
    if (dose.date > throughDate) continue;
    const summary = summaries.get(dose.date) ?? { taken: 0, total: 0 };
    summary.total += 1;
    if (dose.status === 'taken') summary.taken += 1;
    summaries.set(dose.date, summary);
  }
  return summaries;
}

/** Read the selected day's records in schedule order without changing storage. */
export function dosesForHistoryDate(doses: readonly Dose[], date: string, throughDate: string): Dose[] {
  if (date > throughDate) return [];
  return doses.filter(dose => dose.date === date).sort((a, b) => a.time.localeCompare(b.time));
}
