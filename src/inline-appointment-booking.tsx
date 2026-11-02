import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { addVisit, formatDate, localDateKey, removeVisit, upcomingVisits, type Visit } from './domain';
import { isCalendarDate, shiftMonth, startOfMonth } from './calendar';
import { MonthCalendar } from './month-calendar';
import { HospitalContactCard } from './hospital-contact-card';
import { useCare } from './store';
import { Button, C, Card, s } from './ui';
import { MotionPressable as Pressable } from './motion';
import type { BookingScrollAnchor } from './booking-scroll';

function VisitList({ title, visits, onDelete }: { title: string; visits: Visit[]; onDelete: (item: Visit) => void }) {
  if (!visits.length) return null;
  return <Card>
    <Text accessibilityRole="header" style={s.section}>{title}</Text>
    {visits.map((item, index) => <View key={item.id} style={[styles.visit, index > 0 && styles.divider]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.visitTime}>{formatDate(item.date)} {item.time}</Text>
        <Text style={s.body}>{item.hospitalName}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.hospitalName} ${formatDate(item.date)} ${item.time} 일정 삭제`}
        onPress={() => onDelete(item)} style={styles.textButton}><Text style={s.muted}>일정 삭제</Text></Pressable>
    </View>)}
  </Card>;
}

export function VisitSchedule({ scrollAnchor }: { scrollAnchor: BookingScrollAnchor }) {
  const { state, commit, confirm, notify, now } = useCare();
  const params = useLocalSearchParams<{ date?: string }>();
  const linkedDate = isCalendarDate(params.date) ? params.date : undefined;
  const today = localDateKey(now);
  const [date, setDate] = useState(linkedDate ?? today);
  const [month, setMonth] = useState(() => startOfMonth(linkedDate ?? today));
  const [adding, setAdding] = useState(false);
  const [hospitalName, setHospitalName] = useState('');
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  useFocusEffect(useCallback(() => {
    if (linkedDate) {
      setDate(linkedDate);
      setMonth(startOfMonth(linkedDate));
    }
  }, [linkedDate]));

  const upcoming = upcomingVisits(state, now);
  const earlier = state.visits
    .filter(item => item.date === date && new Date(`${item.date}T${item.time}:00`).getTime() <= now.getTime())
    .sort((a, b) => a.time.localeCompare(b.time));
  const counts = new Map<string, number>();
  for (const item of state.visits) counts.set(item.date, (counts.get(item.date) ?? 0) + 1);

  const changeMonth = (amount: number) => {
    const next = shiftMonth(month, amount);
    setMonth(next);
    setDate(next === startOfMonth(today) ? today : next);
  };
  const startAdding = () => {
    setHospitalName(state.hospitalContact.name);
    setHour('');
    setMinute('');
    setAdding(true);
  };
  const save = async () => {
    if (saving.current) return;
    if (Number(hour) > 23 || Number(minute) > 59) {
      notify('진료 시간을 00:00부터 23:59 사이로 입력해 주세요.');
      return;
    }
    saving.current = true;
    setBusy(true);
    const anchor = scrollAnchor.prepare();
    try {
      const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      if (await commit(current => addVisit(current, { date, time, hospitalName }), '진료 일정을 저장했어요.')) setAdding(false);
      else scrollAnchor.cancel(anchor);
    } finally { saving.current = false; setBusy(false); }
  };
  const askDelete = (item: Visit) => {
    confirm({
      title: '진료 일정을 삭제할까요?',
      body: `${item.hospitalName} · ${formatDate(item.date)} ${item.time}\n앱의 일정만 삭제돼요. 병원 예약은 유지됩니다.`,
      label: '일정 삭제',
      onConfirm: async () => {
        const anchor = scrollAnchor.prepare();
        if (!await commit(current => removeVisit(current, item.id), '진료 일정을 삭제했어요.')) scrollAnchor.cancel(anchor);
      },
    });
  };

  return <View style={styles.content}>
    <VisitList title="다음 진료" visits={upcoming} onDelete={askDelete} />
    <View onLayout={scrollAnchor.onAnchorLayout} style={styles.content}>
      <HospitalContactCard editable={false} />
      <View pointerEvents={busy ? 'none' : 'auto'}>
        <MonthCalendar compact month={month} selectedDate={date} today={today}
          onSelectDate={setDate} onChangeMonth={changeMonth} onToday={() => { setMonth(startOfMonth(today)); setDate(today); }}
          getDayInfo={day => {
            const count = counts.get(day);
            return count ? { accessibilityLabel: `진료 일정 ${count}건`, markers: [{ text: '진료', color: C.blue }] } : {};
          }} />
      </View>
      <VisitList title="지난 진료" visits={earlier} onDelete={askDelete} />
      {date >= today && (adding ? <Card>
        <View style={s.row}>
          <Text accessibilityRole="header" style={s.section}>진료 일정 추가</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="진료 일정 입력 닫기" disabled={busy}
            onPress={() => setAdding(false)} style={styles.textButton}><Text style={s.muted}>닫기</Text></Pressable>
        </View>
        <Text style={s.body}>병원에서 정한 진료 시간을 입력하세요.</Text>
        <View>
          <Text style={s.label}>병원명</Text>
          <TextInput accessibilityLabel="진료 병원명" style={s.input} maxLength={80} value={hospitalName} editable={!busy}
            onChangeText={setHospitalName} placeholder="병원 이름" placeholderTextColor={C.muted} />
        </View>
        <View>
          <Text style={s.label}>진료 시간 (24시간제)</Text>
          <View style={s.inline}>
            <TextInput accessibilityLabel="진료 시" style={[s.input, styles.timeInput]} keyboardType="number-pad" maxLength={2} selectTextOnFocus
              value={hour} editable={!busy} onChangeText={value => setHour(value.replace(/\D/g, ''))} placeholder="시" placeholderTextColor={C.muted} />
            <Text style={s.section}>:</Text>
            <TextInput accessibilityLabel="진료 분" style={[s.input, styles.timeInput]} keyboardType="number-pad" maxLength={2} selectTextOnFocus
              value={minute} editable={!busy} onChangeText={value => setMinute(value.replace(/\D/g, ''))} placeholder="분" placeholderTextColor={C.muted} />
          </View>
        </View>
        <Button title={busy ? '저장 중…' : '일정 저장'} disabled={busy || !hospitalName.trim() || !hour || !minute} onPress={() => void save()} />
      </Card> : <Button title="진료 일정 추가" icon="add" onPress={startAdding} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  divider: { borderTopWidth: 1, borderColor: C.line, paddingTop: 8 },
  visitTime: { color: C.navy, fontSize: 16, fontWeight: '700' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  timeInput: { width: 64, textAlign: 'center', textAlignVertical: 'center' },
});
