import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { addVisit, formatDate, localDateKey, removeVisit, upcomingVisits, type Visit } from './domain';
import { isCalendarDate, shiftMonth, startOfMonth } from './calendar';
import { MonthCalendar } from './month-calendar';
import { HospitalContactCard } from './hospital-contact-card';
import { useCare } from './store';
import { Button, C, Card, Icon, s, useInlineEditorBack } from './ui';
import { MotionPressable as Pressable } from './motion';
import type { BookingScrollAnchor } from './booking-scroll';
import { formatClockTime } from './clock-time';
import { suggestedVisitTime } from './visit-time';
import { TimePicker } from './time-picker';

function VisitList({ title, visits, onDelete }: { title: string; visits: Visit[]; onDelete: (item: Visit) => void }) {
  if (!visits.length) return null;
  return <Card>
    <Text accessibilityRole="header" style={s.section}>{title}</Text>
    {visits.map((item, index) => <View key={item.id} style={[styles.visit, index > 0 && styles.divider]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.visitTime}>{formatDate(item.date)} {formatClockTime(item.time)}</Text>
        <Text style={s.body}>{item.hospitalName}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.hospitalName} ${formatDate(item.date)} ${formatClockTime(item.time)} 일정 삭제`}
        onPress={() => onDelete(item)} style={styles.textButton}><Text style={s.muted}>일정 삭제</Text></Pressable>
    </View>)}
  </Card>;
}

export function VisitSchedule({ scrollAnchor }: { scrollAnchor: BookingScrollAnchor }) {
  const { state, commit, confirm, now } = useCare();
  const params = useLocalSearchParams<{ date?: string }>();
  const linkedDate = isCalendarDate(params.date) ? params.date : undefined;
  const today = localDateKey(now);
  const [date, setDate] = useState(linkedDate ?? today);
  const [month, setMonth] = useState(() => startOfMonth(linkedDate ?? today));
  const [adding, setAdding] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const [hospitalName, setHospitalName] = useState('');
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const originDate = useRef(date);

  useFocusEffect(useCallback(() => {
    if (linkedDate) {
      setDate(linkedDate);
      setMonth(startOfMonth(linkedDate));
    }
  }, [linkedDate]));

  const closeEditor = useCallback(() => {
    if (saving.current) return;
    Keyboard.dismiss();
    setDate(originDate.current);
    setMonth(startOfMonth(originDate.current));
    setPickingDate(false);
    setAdding(false);
  }, []);
  const back = useCallback(() => {
    if (pickingDate) setPickingDate(false);
    else closeEditor();
  }, [closeEditor, pickingDate]);
  useInlineEditorBack(adding, back);

  const upcoming = upcomingVisits(state, now);
  const earlier = state.visits
    .filter(item => item.date === date && new Date(`${item.date}T${item.time}:00`).getTime() <= now.getTime())
    .sort((a, b) => a.time.localeCompare(b.time));
  const counts = new Map<string, number>();
  for (const item of state.visits) counts.set(item.date, (counts.get(item.date) ?? 0) + 1);

  const changeMonth = (amount: number) => {
    const next = shiftMonth(month, amount);
    setMonth(next);
    if (!adding) setDate(next === startOfMonth(today) ? today : next);
  };
  const startAdding = () => {
    originDate.current = date;
    setHospitalName(state.hospitalContact.name);
    setTime(null);
    setPickingDate(false);
    setAdding(true);
  };
  let timeError = '';
  if (date < today) timeError = '오늘 이후의 진료일을 선택해 주세요.';
  else if (time && new Date(`${date}T${time}:00`).getTime() <= now.getTime()) timeError = '이미 지난 시간이에요. 진료일이나 시간을 바꿔 주세요.';
  const canSave = !!hospitalName.trim() && time !== null && !timeError && !pickingDate;
  const save = async () => {
    if (saving.current || !canSave) return;
    saving.current = true;
    setBusy(true);
    try {
      if (await commit(current => addVisit(current, { date, time, hospitalName }), `${formatDate(date)} ${formatClockTime(time)} 진료를 저장했어요.`)) {
        Keyboard.dismiss();
        setMonth(startOfMonth(date));
        setAdding(false);
      }
    } finally { saving.current = false; setBusy(false); }
  };
  const askDelete = (item: Visit) => {
    confirm({
      title: '진료 일정을 삭제할까요?',
      body: `${item.hospitalName} · ${formatDate(item.date)} ${formatClockTime(item.time)}\n앱의 일정만 삭제돼요. 병원 예약은 유지됩니다.`,
      label: '일정 삭제',
      cancelLabel: '일정 유지',
      destructive: true,
      onConfirm: async () => {
        const anchor = scrollAnchor.prepare();
        if (!await commit(current => removeVisit(current, item.id), '진료 일정을 삭제했어요.')) scrollAnchor.cancel(anchor);
      },
    });
  };

  const selectDate = (day: string) => {
    setDate(day);
    setPickingDate(false);
  };
  const calendar = <MonthCalendar compact month={month} selectedDate={date} today={today}
    onSelectDate={selectDate} onChangeMonth={changeMonth} onToday={() => { setMonth(startOfMonth(today)); selectDate(today); }}
    getDayInfo={day => {
      const count = counts.get(day);
      return count ? { accessibilityLabel: `진료 일정 ${count}건`, markers: [{ text: '진료', color: C.blue }] } : {};
    }} />;
  if (adding) return <Card>
    <View style={s.row}>
      <Text accessibilityRole="header" style={s.section}>진료 일정 추가</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="진료 일정 입력 취소" disabled={busy}
        onPress={closeEditor} style={styles.textButton}><Text style={s.body}>취소</Text></Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${formatDate(date)} 진료 날짜 변경`} accessibilityState={{ expanded: pickingDate }}
      disabled={busy} onPress={() => { Keyboard.dismiss(); setMonth(startOfMonth(date)); setPickingDate(!pickingDate); }}
      style={styles.dateRow}>
      <View style={s.inline}><Icon name="calendar-outline" size={18} /><Text style={styles.visitTime}>{formatDate(date)}</Text></View>
      <Text style={s.body}>{pickingDate ? '달력 닫기' : '날짜 변경'}</Text>
    </Pressable>
    {pickingDate && calendar}
    <View>
      <Text style={s.label}>병원명</Text>
      <TextInput accessibilityLabel="진료 병원명" style={s.input} maxLength={80} value={hospitalName} editable={!busy}
        returnKeyType="done"
        onChangeText={setHospitalName} placeholder="병원 이름" placeholderTextColor={C.muted} />
    </View>
    <View>
      <Text style={s.label}>진료 시간</Text>
      <TimePicker label="진료 시간 선택" value={time} initialTime={suggestedVisitTime(date === today, now)} onChange={setTime} disabled={busy} />
    </View>
    {!!timeError && <Text accessibilityLiveRegion="polite" style={styles.error}>{timeError}</Text>}
    <Button title={busy ? '저장 중…' : '일정 저장'} disabled={busy || !canSave} onPress={() => void save()} />
  </Card>;
  return <View style={styles.content}>
    <VisitList title="다음 진료" visits={upcoming} onDelete={askDelete} />
    <View onLayout={scrollAnchor.onAnchorLayout} style={styles.content}>
      <HospitalContactCard editable={false} />
      {calendar}
      <VisitList title="지난 진료" visits={earlier} onDelete={askDelete} />
      {date >= today && <Button title="진료 일정 추가" icon="add" onPress={startAdding} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  divider: { borderTopWidth: 1, borderColor: C.line, paddingTop: 8 },
  visitTime: { color: C.navy, fontSize: 16, fontWeight: '700' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', alignContent: 'center', gap: 8, flexWrap: 'wrap', minHeight: 48, paddingHorizontal: 12, backgroundColor: C.pale, borderRadius: 9 },
  error: { color: '#a13b35', fontSize: 13, lineHeight: 20 },
});
