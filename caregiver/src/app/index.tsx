import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { Button, Card, Empty, Icon, s } from '../../../src/ui';
import { MotionPressable } from '../../../src/motion';
import { MonthCalendar } from '../../../src/month-calendar';
import { isCalendarDate, shiftMonth, startOfMonth } from '../../../src/calendar';
import { formatDate } from '../../../src/domain';
import { formatClockTime } from '../../../src/clock-time';
import type { SharedDose } from '../../../shared/care-types';
import { CareButton, CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

/** Today's doses first, then a calendar to look back, like the patient's medication tab. */
export default function MedicationScreen() {
  // An overdue alert or an old history link opens the screen on that day.
  const params = useLocalSearchParams<{ date?: string }>();
  const date = isCalendarDate(params.date) ? params.date : undefined;
  return <Medication key={date ?? 'today'} initialDate={date} />;
}

function Medication({ initialDate }: { initialDate?: string }) {
  const { data, prefs, now, today, medicationClock, visits, networkError, patientName } = useCaregiver();
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate ?? today);
  const [month, setMonth] = useState(() => startOfMonth(initialDate ?? today));
  const groups = useMemo(() => {
    const rows = new Map<string, SharedDose[]>();
    for (const dose of data?.snapshot?.doses ?? []) rows.set(dose.date, [...(rows.get(dose.date) ?? []), dose]);
    for (const list of rows.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
  }, [data]);
  const viewingToday = selectedDate === today;
  const doses = groups.get(selectedDate) ?? [];
  const summary = summarizeDoses(doses, prefs.threshold, now, medicationClock);
  const patient = prefs.patientNickname || patientName;
  const updatedAt = data?.snapshot?.updatedAt;
  // The patient app sends today's rows whenever it is open; none after an upload today means nothing was due.
  const uploadedToday = !!updatedAt && !!medicationClock && medicationClock.wall(Date.parse(updatedAt)).slice(0, 10) === today;
  const [nextVisit] = visits;
  const phone = prefs.phone.replace(/[^\d+]/g, '');
  const call = () => { void Linking.openURL(`tel:${phone}`).catch(() => undefined); };
  const backToToday = () => { setSelectedDate(today); setMonth(startOfMonth(today)); };

  return <CarePage title="복약">
    <View style={{ gap: 5 }}>
      <Text style={s.micro}>{formatDate(selectedDate, { month: 'long', day: 'numeric', weekday: 'long' })}</Text>
      <Text accessibilityRole="header" style={s.title}>{`${patient}의 복약 기록`}</Text>
    </View>
    {!viewingToday && <Button title="오늘로 돌아가기" icon="arrow-back" secondary small onPress={backToToday} />}

    {summary.total === 0 ? <Card>{viewingToday
      ? uploadedToday
        ? <Empty icon="time-outline" title="오늘은 기록할 복약이 없어요" body="환자가 오늘 사용을 시작했다면 다음 복약 시간부터 기록돼요." />
        : <Empty icon="time-outline" title="오늘 일정이 아직 전달되지 않았어요" body="환자가 복약 일정을 설정하고 공유하면 이곳에서 확인할 수 있어요." />
      : <Empty icon="calendar-outline" title="전달된 기록이 없어요" body="이 날짜에 공유된 복약 일정이 없어요." />}</Card> :
      <View style={{ gap: 12 }}>
        <View style={s.row}>
          <Text style={s.section}>{viewingToday ? '오늘 시간표' : '복약 기록'}</Text>
          <Text style={s.micro}>{summary.recorded}/{summary.total}회 기록됨</Text>
        </View>
        {summary.overdue > 0 && <View style={[s.inline, { gap: 8 }]}>
          <Icon name="alert-circle-outline" color={colors.amber} />
          <Text style={[s.body, { flex: 1, color: colors.amber }]}>{viewingToday
            ? `예정 시각에서 ${prefs.threshold}분이 지난 미기록 ${summary.overdue}건` : `미기록 ${summary.overdue}건`}</Text>
        </View>}
        {viewingToday && summary.overdue > 0 && (phone ? <CareButton title={`${patient}님께 전화하기`} icon="call-outline" onPress={call} />
          : <Text style={s.micro}>관리 탭에 환자 연락처를 저장하면 여기서 바로 전화할 수 있어요.</Text>)}
        <DoseList doses={doses} onPhoto={setPhoto} />
      </View>}

    {viewingToday && !networkError && nextVisit && <Link href="./visits" relativeToDirectory asChild>
      <MotionPressable accessibilityRole="button" accessibilityLabel={`다음 진료, ${formatDate(nextVisit.date)} ${formatClockTime(nextVisit.time)}, ${nextVisit.hospitalName}, 진료 일정 보기`}
        style={StyleSheet.flatten([s.card, s.row])}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={s.section}>다음 진료</Text>
          <Text style={s.body}>{formatDate(nextVisit.date)} {formatClockTime(nextVisit.time)} · {nextVisit.hospitalName}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.teal} />
      </MotionPressable>
    </Link>}
    {viewingToday && !!phone && summary.overdue === 0 && <CareButton title={`${patient}님께 전화하기`} icon="call-outline" secondary onPress={call} />}

    <Text style={[s.section, { marginTop: 4 }]}>지난 기록 보기</Text>
    <MonthCalendar compact month={month} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate}
      onChangeMonth={amount => setMonth(current => shiftMonth(current, amount))} onToday={backToToday}
      getDayInfo={day => {
        const count = summarizeDoses(groups.get(day) ?? [], prefs.threshold, now, medicationClock);
        return { accessibilityLabel: count.total ? `${count.recorded}회 기록됨, ${count.overdue}회 미기록` : '전달된 일정 없음', markers: [
          ...(count.recorded ? [{ text: '●', color: colors.teal }] : []),
          ...(count.overdue ? [{ text: '●', color: colors.amber }] : []),
        ] };
      }} />
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
