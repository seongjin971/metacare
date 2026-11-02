import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { calendarDays, startOfMonth } from './calendar';
import { formatDate } from './domain';
import { C, Card, Icon, s } from './ui';
import { MotionPressable as Pressable } from './motion';

export type CalendarDayInfo = {
  accessibilityLabel?: string;
  markers?: { text: string; color: string }[];
  closed?: boolean;
};

type Props = {
  month: string;
  selectedDate: string;
  today: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (amount: number) => void;
  onToday: () => void;
  getDayInfo?: (date: string) => CalendarDayInfo;
  compact?: boolean;
};

export function MonthCalendar({ month, selectedDate, today, onSelectDate, onChangeMonth, onToday, getDayInfo, compact = false }: Props) {
  const cellStyle = [styles.cell, compact && styles.compactCell];
  const days = calendarDays(month);
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return <Card>
    <View style={s.row}>
      <View style={s.inline}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 달" disabled={month === '1000-01-01'} onPress={() => onChangeMonth(-1)} style={styles.monthButton}>
          <Icon name="chevron-back" size={20} color={C.navy} />
        </Pressable>
        <Text accessibilityRole="header" style={s.section}>{formatDate(month, { year: 'numeric', month: 'long' })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다음 달" disabled={month === '9999-12-01'} onPress={() => onChangeMonth(1)} style={styles.monthButton}>
          <Icon name="chevron-forward" size={20} color={C.navy} />
        </Pressable>
      </View>
      {month !== startOfMonth(today) && <Pressable accessibilityRole="button" accessibilityLabel="오늘 날짜 선택" onPress={onToday} style={styles.todayButton}>
        <Text style={styles.todayLabel}>오늘</Text>
      </Pressable>}
    </View>
    <View>
      <View style={styles.week}>
        {['일', '월', '화', '수', '목', '금', '토'].map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}
      </View>
      {weeks.map((week, weekIndex) => <View key={`week-${weekIndex}`} style={styles.week}>
        {week.map((day, index) => {
          if (!day) return <View key={`blank-${index}`} style={cellStyle} />;
          const selected = day === selectedDate;
          const info = getDayInfo?.(day);
          return <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityLabel={`${formatDate(day)}${day === today ? ', 오늘' : ''}${info?.accessibilityLabel ? `, ${info.accessibilityLabel}` : ''}`}
            accessibilityState={{ selected }}
            aria-pressed={selected}
            onPress={() => onSelectDate(day)}
            style={cellStyle}
          >
            <View style={[styles.number, day === today && styles.today, selected && styles.selected]}>
              <Text style={{ fontSize: 15, fontWeight: selected || day === today ? '700' : '400', color: selected ? C.white : info?.closed ? '#b35b56' : day < today ? C.muted : C.navy }}>{Number(day.slice(-2))}</Text>
            </View>
            <View style={styles.markers}>
              {info?.markers?.map((marker, markerIndex) => <Text key={`${marker.text}-${markerIndex}`} style={[styles.marker, { color: marker.color }]}>{marker.text}</Text>)}
            </View>
          </Pressable>;
        })}
      </View>)}
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  todayButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  todayLabel: { fontSize: 13, fontWeight: '600', color: C.blue },
  // Explicit rows prevent fractional percentage rounding from wrapping a day on Android.
  week: { flexDirection: 'row' },
  weekday: { flex: 1, minWidth: 0, textAlign: 'center', color: C.muted, fontSize: 12, paddingBottom: 8 },
  cell: { flex: 1, minWidth: 0, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  compactCell: { minHeight: 48 },
  number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  today: { borderColor: C.blue },
  selected: { backgroundColor: C.blue, borderColor: C.blue },
  markers: { width: '100%', minHeight: 14, flexDirection: 'row', flexWrap: 'wrap', columnGap: 3, alignItems: 'center', justifyContent: 'center' },
  marker: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
});
