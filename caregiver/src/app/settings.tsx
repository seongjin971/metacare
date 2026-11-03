import React, { useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';
import { Card, Icon, s } from '../../../src/ui';
import { useRoleActions } from '../../../src/role-actions';
import { useReducedMotion } from '../../../src/motion';
import { CareButton, CarePage, colors, shortTimestamp, styles } from '../components';
import { useCaregiver } from '../store';

export default function SettingsScreen() {
  const role = useRoleActions();
  const { prefs, data, mode, patientName, savePreferences, disconnect, busy, error } = useCaregiver();
  const [edits, setEdits] = useState<Partial<typeof prefs>>({});
  const draft = { ...prefs, ...edits };
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reducedMotion = useReducedMotion();
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
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
    {(formError || error) && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{formError || error}</Text>}
    {saved && <Text accessibilityLiveRegion="polite" style={[s.body, { color: colors.teal }]}>{mode === 'demo' ? '설정을 적용했어요.' : '설정을 저장했어요.'}</Text>}
    <CareButton title={saving ? '적용 중…' : mode === 'demo' ? '설정 적용' : '설정 저장'} disabled={saving || busy || !dirty} onPress={() => void save()} />
    {role && <CareButton title="역할 변경" secondary disabled={saving || busy} onPress={role.changeRole} />}
    {mode === 'connected' && <CareButton title="환자와 연결 해제" secondary onPress={() => setConfirming(true)} />}
    <Modal visible={confirming} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { if (!busy) setConfirming(false); }}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}>
      <Text accessibilityRole="header" style={s.section}>환자와 연결을 해제할까요?</Text><Text style={s.body}>공유된 기록과 사진을 더 이상 볼 수 없어요. 저장된 별명과 연락처도 이 기기에서 지워져요.</Text>
      {error && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{error}</Text>}
      <CareButton title={busy ? '해제 중…' : '연결 해제'} danger disabled={busy} onPress={() => void disconnect().then(success => { if (success) setConfirming(false); })} />
      <CareButton title="계속 연결하기" secondary disabled={busy} onPress={() => setConfirming(false)} />
    </View></View></Modal>
  </CarePage>;
}
