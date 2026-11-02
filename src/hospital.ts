/** The current clinic schedule closes on Sunday. No public-holiday calendar is assumed. */
export function getHospitalClosure(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식을 확인해 주세요.');
  const [year, month, day] = date.split('-').map(Number);
  const local = new Date(year, month - 1, day, 12);
  if (year < 1000 || local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    throw new Error('올바른 날짜를 선택해 주세요.');
  }
  return local.getDay() === 0 ? '정기 휴무' : null;
}
