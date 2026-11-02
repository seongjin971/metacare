export type MedicationFrequency = 'once' | 'twice' | 'three';

export type MedicationSchedule = {
  frequency: MedicationFrequency;
  times: string[];
};

export const MEDICATION_FREQUENCIES = [
  { value: 'once', label: '하루 한 번', timeLabels: ['복용 시간'], defaultTimes: ['08:00'] },
  { value: 'twice', label: '아침·저녁', timeLabels: ['아침', '저녁'], defaultTimes: ['08:00', '19:00'] },
  { value: 'three', label: '아침·점심·저녁', timeLabels: ['아침', '점심', '저녁'], defaultTimes: ['08:00', '13:00', '19:00'] },
] as const;

export function defaultMedicationSchedule(frequency: MedicationFrequency = 'three'): MedicationSchedule {
  const option = MEDICATION_FREQUENCIES.find(item => item.value === frequency);
  if (!option) throw new Error('복약 횟수를 선택해 주세요.');
  return { frequency, times: [...option.defaultTimes] };
}

/** Keep each time attached to its meal label; reject reversed times instead of silently moving them. */
export function normalizeMedicationSchedule(value: unknown): MedicationSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('복약 일정을 확인해 주세요.');
  const schedule = value as Record<string, unknown>;
  const option = MEDICATION_FREQUENCIES.find(item => item.value === schedule.frequency);
  if (!option) throw new Error('복약 횟수를 선택해 주세요.');
  if (!Array.isArray(schedule.times) || schedule.times.length !== option.timeLabels.length) {
    throw new Error('선택한 복약 횟수에 맞게 시간을 입력해 주세요.');
  }
  const times: string[] = [];
  for (const time of schedule.times) {
    if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error('시간은 00:00부터 23:59까지 입력해 주세요.');
    }
    if (times.includes(time)) throw new Error('복약 시간을 서로 다르게 설정해 주세요.');
    if (times.length && times[times.length - 1] > time) throw new Error('복약 시간은 이른 시간부터 순서대로 설정해 주세요.');
    times.push(time);
  }
  return { frequency: option.value, times };
}

export function medicationScheduleLabel(schedule: MedicationSchedule): string {
  return MEDICATION_FREQUENCIES.find(item => item.value === schedule.frequency)!.label;
}
