import { addDays, createInitialState, localDateKey, selectHospital, type AppState, type Dose } from './domain.ts';

export function createSamplePatientState(now = new Date()): AppState {
  const today = localDateKey(now);
  const initial = createInitialState(now);
  const pastDays = [
    { offset: -3, recorded: 0 },
    { offset: -2, recorded: 1 },
    { offset: -1, recorded: 3 },
  ];
  const history = pastDays.flatMap(({ offset, recorded }) => {
    const date = addDays(today, offset);
    const planned = createInitialState(new Date(`${date}T12:00:00`)).doses;
    return planned.map((dose, index): Dose => {
      if (index >= recorded) return dose;
      const takenAt = new Date(`${dose.date}T${dose.time}:00`);
      takenAt.setMinutes(takenAt.getMinutes() + 5);
      return { ...dose, status: 'taken', takenAt: takenAt.toISOString() };
    });
  });

  const morningClinic = '가정의학과의원';
  const afternoonClinic = '내과의원';
  const withAlternate = selectHospital(initial, afternoonClinic, '', now);
  return {
    ...selectHospital(withAlternate, morningClinic, '', now),
    doses: [...history, ...initial.doses],
    visitsRevision: 1,
    visits: [
      { id: 'sample-morning-visit', hospitalName: morningClinic, date: addDays(today, -2), time: '09:30' },
      { id: 'sample-afternoon-visit', hospitalName: afternoonClinic, date: addDays(today, -1), time: '15:10' },
    ],
  };
}
