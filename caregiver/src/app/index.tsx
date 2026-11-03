import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Empty, Icon, s } from '../../../src/ui';
import { formatDate, localDateKey } from '../../../src/domain';
import type { SharedDose } from '../../../shared/care-types';
import { isUpcomingVisit } from '../../../shared/care-visit';
import { CarePage, DoseList, PhotoViewer, SyncStatus, colors } from '../components';
import { PatientContactAction } from '../patient-contact';
import { getDoseState, summarizeDoses } from '../care-status';
import { useCaregiver } from '../store';

export default function TodayScreen() {
  const { data, prefs, now, mode, networkError, patientName } = useCaregiver();
  const [photo, setPhoto] = useState<SharedDose | null>(null);
  const today = localDateKey(now);
  const doses = (data?.snapshot?.doses ?? []).filter(dose => dose.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const summary = summarizeDoses(doses, prefs.threshold, now);
  const overdue = doses.filter(dose => getDoseState(dose, prefs.threshold, now) === 'overdue');
  const patient = prefs.patientNickname || patientName;
  const nextVisit = data?.snapshot?.nextVisit;
  return <CarePage title="오늘">
    <View style={{ gap: 5 }}><Text style={s.micro}>{formatDate(today, { month: 'long', day: 'numeric', weekday: 'long' })}</Text><Text accessibilityRole="header" style={s.title}>{`${patient}의 복약 기록`}</Text></View>
    {summary.total === 0 ? <Card><Empty icon="time-outline" title="오늘 일정이 아직 전달되지 않았어요" body="환자 앱에서 일정을 설정하고 공유하면 이곳에서 확인할 수 있어요." /></Card>
      : summary.overdue > 0 ? <Card style={{ backgroundColor: colors.amberSoft, borderColor: '#EFE0C8', gap: 12 }}>
        <View style={[s.inline, { gap: 9 }]}><Icon name="alert-circle-outline" color={colors.amber} /><Text style={[s.section, { color: colors.amber }]}>{overdue.length === 1 ? `${overdue[0].label} · 미기록` : `확인이 필요한 미기록 ${overdue.length}건`}</Text></View>
        {overdue.length > 1 && <Text style={s.body}>{overdue.map(dose => `${dose.time} ${dose.label}`).join(' · ')}</Text>}
        <Text style={s.body}>예정 시각에서 설정한 {prefs.threshold}분이 지나도 받은 기록이 없어요.</Text>
        <PatientContactAction patient={patient} />
      </Card>
        : <View style={[s.inline, { alignItems: 'flex-start', gap: 10, paddingVertical: 4 }]}><Icon name={summary.recorded === summary.total ? 'checkmark-circle-outline' : 'time-outline'} color={colors.teal} /><View style={{ flex: 1, gap: 5 }}><Text style={s.section}>{summary.recorded === summary.total ? '오늘 일정의 기록을 모두 받았어요' : '아직 확인이 필요한 미기록은 없어요'}</Text><Text style={s.body}>오늘 {summary.total}회 일정 중 {summary.recorded}회 기록됨</Text></View></View>}
    <View style={{ gap: 12 }}>
      <View style={s.row}><Text style={s.section}>오늘 시간표</Text><Text style={s.micro}>{mode === 'demo' ? '예시 기준' : '마지막 수신 기준'}</Text></View>
      {doses.length > 0 ? <DoseList doses={doses} onPhoto={setPhoto} /> : <Text style={s.body}>전달된 일정이 없어요.</Text>}
      <Text style={s.micro}>미기록은 공유된 기록이 없다는 뜻이에요. 실제 복용 여부는 환자에게 확인해 주세요.</Text>
    </View>
    {!networkError && nextVisit && isUpcomingVisit(nextVisit, now) && <Card style={{ gap: 5 }}>
      <Text style={s.section}>다음 진료</Text>
      <Text style={s.body}>{formatDate(nextVisit.date)} {nextVisit.time} · {nextVisit.hospitalName}</Text>
    </Card>}
    <SyncStatus />
    <PhotoViewer dose={photo} onClose={() => setPhoto(null)} />
  </CarePage>;
}
