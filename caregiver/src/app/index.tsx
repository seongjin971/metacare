import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Empty, Icon, s } from '../../../src/ui';
import { formatDate } from '../../../src/domain';
import { formatClockTime } from '../../../src/clock-time';
import type { SharedDose } from '../../../shared/care-types';
import { isUpcomingVisit } from '../../../shared/care-visit';
import { CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

export default function TodayScreen() {
  const { data, prefs, now, today, medicationClock, networkError, patientName } = useCaregiver();
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const doses = (data?.snapshot?.doses ?? []).filter(dose => dose.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const summary = summarizeDoses(doses, prefs.threshold, now, medicationClock);
  const patient = prefs.patientNickname || patientName;
  const nextVisit = data?.snapshot?.nextVisit;
  return <CarePage title="오늘">
    <View style={{ gap: 5 }}><Text style={s.micro}>{formatDate(today, { month: 'long', day: 'numeric', weekday: 'long' })}</Text><Text accessibilityRole="header" style={s.title}>{`${patient}의 복약 기록`}</Text></View>
    {summary.total === 0 ? <Card><Empty icon="time-outline" title="오늘 일정이 아직 전달되지 않았어요" body="환자가 복약 일정을 설정하고 공유하면 이곳에서 확인할 수 있어요." /></Card> :
      <View style={{ gap: 12 }}>
        <View style={s.row}><Text style={s.section}>오늘 시간표</Text><Text style={s.micro}>{summary.recorded}/{summary.total}회 기록됨</Text></View>
        {summary.overdue > 0 && <View style={[s.inline, { gap: 8 }]}>
          <Icon name="alert-circle-outline" color={colors.amber} />
          <Text style={[s.body, { flex: 1, color: colors.amber }]}>예정 시각에서 {prefs.threshold}분이 지난 미기록 {summary.overdue}건</Text>
        </View>}
        <DoseList doses={doses} onPhoto={setPhoto} />
      </View>}
    {!networkError && nextVisit && isUpcomingVisit(nextVisit, now) && <Card style={{ gap: 5 }}>
      <Text style={s.section}>다음 진료</Text>
      <Text style={s.body}>{formatDate(nextVisit.date)} {formatClockTime(nextVisit.time)} · {nextVisit.hospitalName}</Text>
    </Card>}
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
