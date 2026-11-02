import React, { useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';
import { Card, Icon, s } from '../../../src/ui';
import { MotionPressable as Pressable, useReducedMotion } from '../../../src/motion';
import { CareButton, CarePage, colors, shortTimestamp, styles } from '../components';
import { OVERDUE_THRESHOLDS } from '../care-status';
import { useCaregiver } from '../store';

export default function SettingsScreen() {
  const { prefs, data, mode, patientName, savePreferences, disconnect, busy, error, exitDemo } = useCaregiver();
  const [draft, setDraft] = useState(prefs);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reducedMotion = useReducedMotion();
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  const save = async () => {
    setSaved(false); setFormError(null);
    const phone = draft.phone.trim();
    const digits = phone.replace(/\D/g, '');
    if (phone && (!/^\+?[\d ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15)) { setFormError('전화번호를 확인해 주세요. 숫자 7~15자리와 공백, 괄호, 하이픈을 사용할 수 있어요.'); return; }
    setSaving(true);
    const normalized = { ...draft, phone, patientNickname: draft.patientNickname.trim() };
    const success = await savePreferences(normalized);
    if (success) setDraft(normalized);
    setSaving(false); setSaved(success);
  };
  const update = (patch: Partial<typeof draft>) => { setDraft(value => ({ ...value, ...patch })); setSaved(false); setFormError(null); };
  return <CarePage title="관리">
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon name="person-circle-outline" size={44} color={colors.teal} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.micro}>{mode === 'demo' ? '예시 환자 프로필' : '연결된 환자 프로필'}</Text>
        <Text accessibilityRole="header" style={s.section}>{patientName}</Text>
        {mode === 'connected' && data?.connectedAt && <Text style={s.micro}>{shortTimestamp(data.connectedAt)} 연결</Text>}
      </View>
    </Card>
    <Card style={{ gap: 18 }}>
      <View><Text style={s.label}>환자 별명</Text><TextInput accessibilityLabel="환자 별명" value={draft.patientNickname} onChangeText={patientNickname => update({ patientNickname })} placeholder="예: 엄마 (선택)" placeholderTextColor="#8C99A4" maxLength={30} style={s.input} /></View>
      <View><Text style={s.label}>환자 연락처 · 선택</Text><TextInput accessibilityLabel="환자 연락처" value={draft.phone} onChangeText={phone => update({ phone })} placeholder="전화번호" placeholderTextColor="#8C99A4" keyboardType="phone-pad" maxLength={25} style={s.input} /><Text style={[s.micro, { marginTop: 6 }]}>직접 입력한 번호로 전화 앱을 열어요.</Text></View>
      <Text style={s.micro}>{mode === 'demo' ? '설정 변경은 예시를 나가면 사라져요.' : '별명과 연락처는 이 기기에만 저장돼요.'}</Text>
    </Card>
    <Card style={{ gap: 12 }}>
      <Text style={s.section}>미기록 표시 기준</Text><Text style={s.body}>예정 시각에서 아래 시간이 지나면 미기록으로 표시해요.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{OVERDUE_THRESHOLDS.map(threshold => <Pressable key={threshold} accessibilityRole="button" accessibilityLabel={`미기록 기준 ${threshold}분`} accessibilityState={{ selected: draft.threshold === threshold }} onPress={() => update({ threshold })} style={{ minHeight: 44, minWidth: 62, flexGrow: 1, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: draft.threshold === threshold ? colors.teal : colors.soft }}><Text style={{ color: draft.threshold === threshold ? 'white' : colors.teal, fontSize: 14, fontWeight: '600' }}>{threshold}분</Text></Pressable>)}</View>
      <Text style={s.micro}>앱을 열어 둔 동안의 표시 기준이에요. 앱 밖으로 알림을 보내는 설정은 아니에요.</Text>
    </Card>
    {(formError || error) && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{formError || error}</Text>}
    {saved && <Text accessibilityLiveRegion="polite" style={[s.body, { color: colors.teal }]}>{mode === 'demo' ? '예시 설정을 적용했어요.' : '설정을 저장했어요.'}</Text>}
    <CareButton title={saving ? '저장 중…' : '설정 저장'} disabled={saving || busy || !dirty} onPress={() => void save()} />
    <View style={{ gap: 10, paddingTop: 8 }}><Text style={s.micro}>연결을 해제하면 이 기기의 공유 기록과 연락처가 지워져요. 다시 연결할 때는 새 코드가 필요해요.</Text>
      <CareButton title={mode === 'demo' ? '예시 나가기' : '환자와 연결 해제'} secondary onPress={() => mode === 'demo' ? exitDemo() : setConfirming(true)} />
    </View>
    <Modal visible={confirming} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { if (!busy) setConfirming(false); }}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}>
      <Text accessibilityRole="header" style={s.section}>환자와 연결을 해제할까요?</Text><Text style={s.body}>공유된 기록과 사진을 더 이상 볼 수 없어요. 저장된 별명과 연락처도 이 기기에서 지워져요.</Text>
      {error && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{error}</Text>}
      <CareButton title={busy ? '해제 중…' : '연결 해제'} danger disabled={busy} onPress={() => void disconnect().then(success => { if (success) setConfirming(false); })} />
      <CareButton title="계속 연결하기" secondary disabled={busy} onPress={() => setConfirming(false)} />
    </View></View></Modal>
  </CarePage>;
}
