import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Card, Empty, Icon, s } from '../../../src/ui';
import { MotionPressable } from '../../../src/motion';
import { formatDate } from '../../../src/domain';
import { formatClockTime } from '../../../src/clock-time';
import type { SharedDose } from '../../../shared/care-types';
import { CareButton, CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

export default function TodayScreen() {
  const { data, prefs, now, today, medicationClock, visits, networkError, patientName } = useCaregiver();
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const doses = (data?.snapshot?.doses ?? []).filter(dose => dose.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const summary = summarizeDoses(doses, prefs.threshold, now, medicationClock);
  const patient = prefs.patientNickname || patientName;
  const [nextVisit] = visits;
  const phone = prefs.phone.replace(/[^\d+]/g, '');
  const call = () => { void Linking.openURL(`tel:${phone}`).catch(() => undefined); };
  return <CarePage title="오늘">
    <View style={{ gap: 5 }}><Text style={s.micro}>{formatDate(today, { month: 'long', day: 'numeric', weekday: 'long' })}</Text><Text accessibilityRole="header" style={s.title}>{`${patient}의 복약 기록`}</Text></View>
    {summary.total === 0 ? <Card><Empty icon="time-outline" title="오늘 일정이 아직 전달되지 않았어요" body="환자가 복약 일정을 설정하고 공유하면 이곳에서 확인할 수 있어요." /></Card> :
      <View style={{ gap: 12 }}>
        <View style={s.row}><Text style={s.section}>오늘 시간표</Text><Text style={s.micro}>{summary.recorded}/{summary.total}회 기록됨</Text></View>
        {summary.overdue > 0 && <View style={[s.inline, { gap: 8 }]}>
          <Icon name="alert-circle-outline" color={colors.amber} />
          <Text style={[s.body, { flex: 1, color: colors.amber }]}>예정 시각에서 {prefs.threshold}분이 지난 미기록 {summary.overdue}건</Text>
        </View>}
        {summary.overdue > 0 && (phone ? <CareButton title={`${patient}님께 전화하기`} icon="call-outline" onPress={call} />
          : <Text style={s.micro}>관리 탭에 환자 연락처를 저장하면 여기서 바로 전화할 수 있어요.</Text>)}
        <DoseList doses={doses} onPhoto={setPhoto} />
      </View>}
    {!networkError && nextVisit && <Link href="./visits" relativeToDirectory asChild>
      <MotionPressable accessibilityRole="button" accessibilityLabel={`다음 진료, ${formatDate(nextVisit.date)} ${formatClockTime(nextVisit.time)}, ${nextVisit.hospitalName}, 진료 일정 보기`}
        style={StyleSheet.flatten([s.card, s.row])}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={s.section}>다음 진료</Text>
          <Text style={s.body}>{formatDate(nextVisit.date)} {formatClockTime(nextVisit.time)} · {nextVisit.hospitalName}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.teal} />
      </MotionPressable>
    </Link>}
    {!!phone && summary.overdue === 0 && <CareButton title={`${patient}님께 전화하기`} icon="call-outline" secondary onPress={call} />}
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
