import { addDays, localDateKey } from '../../src/domain';
import type { CaregiverData, SharedDose } from '../../shared/care-types';

export function makeDemoData(date = localDateKey()): CaregiverData {
  const doses: SharedDose[] = [];
  for (let offset = -9; offset <= 0; offset += 1) {
    const day = addDays(date, offset);
    for (const [index, time] of ['08:00', '13:00', '20:00'].entries()) {
      const recorded = offset < 0 ? !(offset === -3 && index === 1) : index === 0;
      doses.push({
        id: `example-${day}-${time}`, date: day, time, label: ['아침 약', '점심 약', '저녁 약'][index],
        status: recorded ? 'taken' : 'pending',
        ...(recorded ? { takenAt: `${day}T${time}:00`, photo: { id: `example-photo-${day}-${time}`, capturedAt: `${day}T${time}:00`, verified: false } } : {}),
      });
    }
  }
  return {
    connectedAt: `${addDays(date, -9)}T12:00:00`, caregiverName: '보호자',
    snapshot: { patientName: '김메타', schedule: { frequency: 'three', times: ['08:00', '13:00', '20:00'] }, doses, updatedAt: `${date}T14:20:00` },
  };
}
