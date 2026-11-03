import { addDays, localDateKey } from '../../src/domain.ts';
import type { CaregiverData, SharedDose } from '../../shared/care-types.ts';

export function makeDemoData(now = new Date()): CaregiverData {
  const date = localDateKey(now);
  const doses: SharedDose[] = [];
  for (let offset = -9; offset <= 0; offset += 1) {
    const day = addDays(date, offset);
    for (const [index, time] of ['08:00', '13:00', '20:00'].entries()) {
      const plannedAt = `${day}T${time}:00`;
      const recorded = offset < 0 && !(offset === -3 && index === 1);
      doses.push({
        id: `example-${day}-${time}`, date: day, time, label: ['아침 약', '점심 약', '저녁 약'][index],
        status: recorded ? 'taken' : 'pending',
        ...(recorded ? { takenAt: plannedAt } : {}),
      });
    }
  }
  return {
    connectedAt: `${addDays(date, -9)}T12:00:00`, caregiverName: '보호자',
    snapshot: { patientName: '김정희', schedule: { frequency: 'three', times: ['08:00', '13:00', '20:00'] }, doses, updatedAt: now.toISOString() },
  };
}
