import React, { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Empty, s } from '../../../src/ui';
import { MonthCalendar } from '../../../src/month-calendar';
import { isCalendarDate, shiftMonth, startOfMonth } from '../../../src/calendar';
import type { SharedDose } from '../../../shared/care-types';
import { CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const date = isCalendarDate(params.date) ? params.date : undefined;
  return <HistoryCalendar key={date} initialDate={date} />;
}

function HistoryCalendar({ initialDate }: { initialDate?: string }) {
  const { data, prefs, now, today, medicationClock } = useCaregiver();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate ?? null);
  const [month, setMonth] = useState(() => startOfMonth(initialDate ?? today));
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const groups = useMemo(() => {
    const rows = new Map<string, SharedDose[]>();
    for (const dose of data?.snapshot?.doses ?? []) rows.set(dose.date, [...(rows.get(dose.date) ?? []), dose]);
    for (const list of rows.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
  }, [data]);
  const doses = selectedDate ? groups.get(selectedDate) ?? [] : [];
  return <CarePage title="복약 기록">
    <MonthCalendar compact month={month} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate} onChangeMonth={amount => {
      setMonth(current => shiftMonth(current, amount));
      setSelectedDate(null);
    }} onToday={() => { setMonth(startOfMonth(today)); setSelectedDate(today); }} getDayInfo={date => {
      const count = summarizeDoses(groups.get(date) ?? [], prefs.threshold, now, medicationClock);
      return { accessibilityLabel: count.total ? `${count.recorded}회 기록됨, ${count.overdue}회 미기록` : '전달된 일정 없음', markers: [
        ...(count.recorded ? [{ text: '●', color: colors.teal }] : []),
        ...(count.overdue ? [{ text: '●', color: colors.amber }] : []),
      ] };
    }} />
    {!selectedDate ? <Text style={s.body}>날짜를 선택해 복약 기록을 확인하세요.</Text>
      : doses.length ? <View style={{ gap: 8 }}>
        <Text style={s.micro}>{doses.filter(dose => dose.status === 'taken').length}/{doses.length}회 기록됨</Text>
        <DoseList doses={doses} onPhoto={setPhoto} />
      </View> : <Card><Empty icon="calendar-outline" title="전달된 일정이 없어요" body="기록이 있는 날짜를 선택해 주세요." /></Card>}
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
