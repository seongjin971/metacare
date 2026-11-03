import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { localDateKey, type Dose } from './domain';
import { C, Card, s } from './ui';
import { DosePhotoButton } from './dose-photo-button';

function recordedAtLabel(dose: Dose): string | null {
  if (!dose.takenAt) return null;
  const recorded = new Date(dose.takenAt);
  if (!Number.isFinite(recorded.getTime())) return null;
  const time = recorded.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (localDateKey(recorded) === dose.date) return time;
  const date = recorded.toLocaleDateString('ko-KR', {
    ...(recorded.getFullYear() !== Number(dose.date.slice(0, 4)) ? { year: 'numeric' as const } : {}),
    month: 'numeric', day: 'numeric',
  });
  return `${date} ${time}`;
}

/** Selected-day history stays read-only; today's actions live on the medication screen. */
export function MedicationHistoryCard({ doses, sample = false, emptyMessage = '복약 기록이 없어요.' }: { doses: readonly Dose[]; sample?: boolean; emptyMessage?: string }) {
  const taken = doses.filter(dose => dose.status === 'taken').length;

  return (
    <Card>
      <View style={s.inline}>
        <Text style={s.section}>복약 현황</Text>
        {doses.length > 0 && <Text style={[s.muted, taken === doses.length && { color: C.green }]}>{taken}/{doses.length}</Text>}
      </View>
      {doses.length > 0 ? (
        <View>
          {doses.map((dose, index) => {
            const recorded = dose.status === 'taken';
            const recordedAt = recorded ? recordedAtLabel(dose) : null;
            return (
              <React.Fragment key={dose.id}>
                {index > 0 && <View style={s.divider} />}
                <View style={styles.row}>
                  <View style={styles.details}>
                    <Text style={styles.label}>{dose.label}</Text>
                    <Text style={s.muted}>{dose.time}</Text>
                  </View>
                  <View style={styles.status}>
                    <Text style={[styles.statusText, { color: recorded ? C.green : C.muted }]}>
                      {recorded ? recordedAt ? `${recordedAt} 기록` : '기록됨' : '미기록'}
                    </Text>
                    {recorded && (dose.photo ? <DosePhotoButton photo={dose.photo} label={dose.label} /> : !sample && <Text style={s.micro}>자가 기록</Text>)}
                  </View>
                </View>
              </React.Fragment>
            );
          })}
        </View>
      ) : <Text style={s.muted}>{emptyMessage}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 72, paddingVertical: 10 },
  details: { flex: 1, gap: 4 },
  label: { color: C.navy, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  status: { maxWidth: '55%', alignItems: 'flex-end', gap: 3 },
  statusText: { fontSize: 13, lineHeight: 20, textAlign: 'right' },
});
