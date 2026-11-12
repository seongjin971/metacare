import React, { useState } from 'react';
import { Linking, Modal, Switch, Text, TextInput, View } from 'react-native';
import { Card, Icon, s } from '../../../src/ui';
import { useRoleActions } from '../../../src/role-actions';
import { MotionPressable as Pressable, useReducedMotion } from '../../../src/motion';
import { OVERDUE_THRESHOLDS, type OverdueThreshold } from '../care-status';
import { careAlertsHidden, supportsCareAlerts } from '../alert-device';
import { CareButton, CarePage, colors, shortTimestamp, styles } from '../components';
import { useCaregiver } from '../store';

export default function SettingsScreen() {
  const role = useRoleActions();
  const { prefs, alerts, data, mode, patientName, savePreferences, disconnect, busy, error } = useCaregiver();
  const [edits, setEdits] = useState<Partial<typeof prefs>>({});
  const draft = { ...prefs, ...edits };
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reducedMotion = useReducedMotion();
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  const canRegister = mode === 'connected' && supportsCareAlerts;
  const timingDisabled = saving || busy || alerts.busy || (canRegister && !alerts.confirmed);
  const changeTiming = async (threshold: OverdueThreshold, enabled: boolean) => {
    if (timingDisabled) return;
    setSaving(true); setSaved(false); setFormError(null);
    try {
      if (canRegister && (enabled || alerts.confirmed?.enabled)) {
        if (!await alerts.update(enabled, threshold)) return;
      }
      if (enabled || alerts.confirmed?.enabled || threshold !== prefs.threshold) await savePreferences({ ...prefs, threshold });
    } finally { setSaving(false); }
  };
  const save = async () => {
    setSaved(false); setFormError(null);
    const phone = draft.phone.trim();
    if (phone && !/^\+?\d{7,15}$/.test(phone.replace(/[ ()-]/g, ''))) { setFormError('전화번호를 확인해 주세요. 숫자 7~15자리와 공백, 괄호, 하이픈을 사용할 수 있어요.'); return; }
    setSaving(true);
    const normalized = { ...draft, phone, patientNickname: draft.patientNickname.trim() };
    const success = await savePreferences(normalized);
    if (success) setEdits({});
    setSaving(false); setSaved(success);
  };
  const update = (patch: Partial<typeof draft>) => { setEdits(value => ({ ...value, ...patch })); setSaved(false); setFormError(null); };
  return <CarePage title="관리">
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon name="person-circle-outline" size={44} color={colors.teal} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.micro}>환자 프로필</Text>
        <Text accessibilityRole="header" style={s.section}>{patientName}</Text>
        {mode === 'connected' && data?.connectedAt && <Text style={s.micro}>{shortTimestamp(data.connectedAt)} 연결</Text>}
      </View>
    </Card>
    <Card style={{ gap: 18 }}>
      <View><Text style={s.label}>환자 별명 · 선택</Text><TextInput accessibilityLabel="환자 별명" value={draft.patientNickname} onChangeText={patientNickname => update({ patientNickname })} placeholder="별명 입력" placeholderTextColor="#8C99A4" maxLength={30} style={s.input} /></View>
      <View><Text style={s.label}>환자 연락처 · 선택</Text><TextInput accessibilityLabel="환자 연락처" value={draft.phone} onChangeText={phone => update({ phone })} placeholder="전화번호" placeholderTextColor="#8C99A4" keyboardType="phone-pad" maxLength={25} style={s.input} /></View>
      <Text style={s.micro}>{mode === 'demo' ? '환자 연결 전에는 변경한 내용이 이번 사용에만 적용돼요.' : '별명과 연락처는 이 기기에만 저장돼요.'}</Text>
    </Card>
    {!careAlertsHidden && <Card style={{ gap: 12 }}>
      <Text style={s.section}>복약 미기록 알림</Text>
      <Text style={s.body}>복약 예정 시각에서 얼마나 기다린 뒤 알려드릴까요?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{OVERDUE_THRESHOLDS.map(threshold => <Pressable key={threshold} accessibilityRole="button"
        accessibilityLabel={`미기록 기준 ${threshold}분`} accessibilityState={{ selected: prefs.threshold === threshold, disabled: timingDisabled }} disabled={timingDisabled}
        onPress={() => void changeTiming(threshold, alerts.confirmed?.enabled ?? false)}
        style={{ minHeight: 44, minWidth: 62, flexGrow: 1, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: prefs.threshold === threshold ? colors.teal : colors.soft }}>
        <Text style={{ color: prefs.threshold === threshold ? 'white' : colors.teal, fontSize: 14, fontWeight: '600' }}>{threshold < 60 ? `${threshold}분` : `${threshold / 60}시간`}</Text>
      </Pressable>)}</View>
      <View style={[s.row, { gap: 16 }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.label}>미기록 알림 받기</Text>
          <Text style={s.micro}>{mode === 'demo' ? '환자와 연결한 뒤 켤 수 있어요.'
            : !supportsCareAlerts ? '설치한 메타케어 앱에서 켤 수 있어요.'
            : alerts.otherDevice ? '다른 기기에서 알림을 받고 있어요. 켜면 이 기기에서 받아요.'
            : '기록이 없으면 회차마다 한 번 알려드려요. 잠금화면에는 약 정보 없이 “확인할 복약 기록이 있어요”라고만 보여요.'}</Text>
        </View>
        <Switch accessibilityLabel="미기록 알림 받기" value={canRegister && alerts.confirmed?.enabled === true}
          disabled={!canRegister || timingDisabled} onValueChange={enabled => void changeTiming(prefs.threshold, enabled)}
          trackColor={{ false: '#dfe5ee', true: colors.teal }} />
      </View>
      {canRegister && alerts.blocked && <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={[s.micro, { color: colors.amber }]}>휴대폰 설정에서 메타케어의 알림을 허용한 뒤 다시 켜 주세요.</Text>
        <CareButton title="휴대폰 설정 열기" secondary onPress={() => {
          void Linking.openSettings().catch(() => setFormError('휴대폰 설정에서 메타케어의 알림을 찾아 허용해 주세요.'));
        }} />
      </View>}
      {!!alerts.error && <Text accessibilityRole="alert" style={[s.micro, { color: colors.amber }]}>{alerts.error}</Text>}
      {canRegister && !alerts.confirmed && (alerts.error
        ? <CareButton title="알림 설정 다시 확인" secondary onPress={() => void alerts.refresh()} />
        : <Text style={s.micro}>알림 설정 확인 중…</Text>)}
      <Text style={s.micro}>미기록 알림은 환자의 기록이 아직 도착하지 않았다는 뜻이에요. 실제로 약을 먹지 않았다는 뜻은 아니에요.</Text>
    </Card>}
    {(formError || error) && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{formError || error}</Text>}
    {saved && <Text accessibilityLiveRegion="polite" style={[s.body, { color: colors.teal }]}>{mode === 'demo' ? '설정을 적용했어요.' : '설정을 저장했어요.'}</Text>}
    <CareButton title={saving ? '적용 중…' : mode === 'demo' ? '설정 적용' : '설정 저장'} disabled={saving || busy || !dirty} onPress={() => void save()} />
    {role && <CareButton title="역할 변경" secondary disabled={saving || busy || alerts.busy} onPress={role.changeRole} />}
    {mode === 'connected' && <CareButton title="환자와 연결 해제" secondary onPress={() => setConfirming(true)} />}
    <Modal visible={confirming} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { if (!busy) setConfirming(false); }}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}>
      <Text accessibilityRole="header" style={s.section}>환자와 연결을 해제할까요?</Text><Text style={s.body}>공유된 기록과 사진을 더 이상 볼 수 없어요. 저장된 별명과 연락처도 이 기기에서 지워져요.</Text>
      {error && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{error}</Text>}
      <CareButton title={busy ? '해제 중…' : '연결 해제'} danger disabled={busy} onPress={() => void disconnect().then(success => { if (success) setConfirming(false); })} />
      <CareButton title="계속 연결하기" secondary disabled={busy} onPress={() => setConfirming(false)} />
    </View></View></Modal>
  </CarePage>;
}
