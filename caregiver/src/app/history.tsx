import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Empty, s } from '../../../src/ui';
import { MonthCalendar } from '../../../src/month-calendar';
import { shiftMonth, startOfMonth } from '../../../src/calendar';
import { localDateKey } from '../../../src/domain';
import type { SharedDose } from '../../../shared/care-types';
import { CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

export default function HistoryScreen() {
  const { data, prefs, now } = useCaregiver();
  const today = localDateKey(now);
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(startOfMonth(today));
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const groups = useMemo(() => {
    const rows = new Map<string, SharedDose[]>();
    for (const dose of data?.snapshot?.doses ?? []) rows.set(dose.date, [...(rows.get(dose.date) ?? []), dose]);
    for (const list of rows.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
  }, [data]);
  const doses = groups.get(selectedDate) ?? [];
  return <CarePage title="기록">
    <MonthCalendar compact month={month} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate} onChangeMonth={amount => setMonth(value => shiftMonth(value, amount))} onToday={() => { setMonth(startOfMonth(today)); setSelectedDate(today); }} getDayInfo={date => {
      const count = summarizeDoses(groups.get(date) ?? [], prefs.threshold, now);
      return { accessibilityLabel: count.total ? `${count.recorded}회 기록됨, ${count.overdue}회 미기록` : '전달된 일정 없음', markers: [
        ...(count.recorded ? [{ text: '●', color: colors.teal }] : []),
        ...(count.overdue ? [{ text: '●', color: colors.amber }] : []),
      ] };
    }} />
    <View style={{ gap: 12 }}>
      <View style={s.row}><Text accessibilityRole="header" style={s.section}>복약 기록</Text>{doses.length > 0 && <Text style={s.micro}>{doses.filter(dose => dose.status === 'taken').length}/{doses.length}회 기록됨</Text>}</View>
      {doses.length ? <DoseList doses={doses} onPhoto={setPhoto} /> : <Card><Empty icon="calendar-outline" title="전달된 일정이 없어요" body="이 날짜에 공유된 일정과 기록이 없어요. 기록이 있는 날짜를 선택해 주세요." /></Card>}
      <Text style={s.micro}>사진과 기록만으로 실제 복용 여부를 확인할 수는 없어요.</Text>
    </View>
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
