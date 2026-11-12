import React from 'react';
import { Text, View } from 'react-native';
import { formatClockTime } from '../../../src/clock-time';
import { formatDate } from '../../../src/domain';
import { Card, Empty, s } from '../../../src/ui';
import { CarePage, SyncStatus } from '../components';
import { useCaregiver } from '../store';

export default function VisitsScreen() {
  const { data, today, visits, visitsLoading, networkError } = useCaregiver();
  const snapshot = data?.snapshot;
  const sharingAgenda = snapshot?.upcomingVisits !== undefined;
  return <CarePage title="진료 일정">
    {networkError ? <Card><Text style={s.body}>서버에 연결하면 진료 일정을 확인할 수 있어요.</Text></Card>
      : visitsLoading ? <Card><Text accessibilityLiveRegion="polite" style={s.body}>진료 일정을 불러오는 중이에요.</Text></Card>
      : visits.length > 0 ? <Card>
        {visits.map((visit, index) => <React.Fragment key={JSON.stringify([visit.date, visit.time, visit.hospitalName])}>
          {visits[index - 1]?.date !== visit.date && <>
            {index > 0 && <View style={s.divider} />}
            <Text accessibilityRole="header" style={s.section}>{formatDate(visit.date, {
              ...(visit.date.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }),
              month: 'long', day: 'numeric', weekday: 'short',
            })}</Text>
          </>}
          <View style={[s.inline, { gap: 12 }]}>
            <Text style={[s.label, { minWidth: 82, marginBottom: 0 }]}>{formatClockTime(visit.time)}</Text>
            <Text style={[s.body, { flex: 1 }]}>{visit.hospitalName}</Text>
          </View>
        </React.Fragment>)}
      </Card>
      : sharingAgenda ? <Card><Empty icon="calendar-outline" title="예정된 진료가 없어요" body="환자가 새 진료 일정을 등록하면 여기에 표시돼요." /></Card>
      : <Card><Empty icon="calendar-outline" title="진료 일정이 공유되지 않았어요" body="환자 휴대폰의 내 관리 → 보호자 연결에서 ‘진료 일정 공유’를 켜면 예정된 진료가 여기에 보여요." /></Card>}
    <SyncStatus />
  </CarePage>;
}
