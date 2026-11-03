import React, { useCallback, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { s, useInlineEditorBack } from '../../src/ui';
import { CareButton, colors } from './components';
import { useCaregiver } from './store';

export function dialNumber(input: string): string | null {
  const number = input.trim().replace(/[ ()-]/g, '');
  return /^\+?\d{7,15}$/.test(number) ? number : null;
}

export function PatientContactAction({ patient }: { patient: string }) {
  const { prefs, savePreferences } = useCaregiver();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cancel = useCallback(() => { setDraft(null); setError(''); }, []);
  useInlineEditorBack(draft !== null && !saving, cancel);

  async function save() {
    if (saving || !draft?.trim()) return;
    if (!dialNumber(draft)) { setError('전화번호를 7~15자리로 입력해 주세요.'); return; }
    setSaving(true);
    const saved = await savePreferences({ ...prefs, phone: draft.trim() });
    setSaving(false);
    if (saved) { setDraft(null); setError(''); }
    else setError('연락처를 저장하지 못했어요. 다시 시도해 주세요.');
  }

  function contact() {
    setError('');
    const number = dialNumber(prefs.phone);
    if (!number) { setDraft(''); return; }
    void Linking.openURL(`tel:${number}`).catch(() => setError(`전화 앱을 열 수 없어요. 등록한 번호는 ${prefs.phone}예요.`));
  }

  return <View style={{ gap: 8 }}>
    {draft === null ? <CareButton title={dialNumber(prefs.phone) ? `${patient}에게 전화하기` : '환자 연락처 등록'}
      icon="call-outline" secondary onPress={contact} /> : <>
      <Text style={s.label}>환자 연락처</Text>
      <TextInput accessibilityLabel="환자 연락처" value={draft} onChangeText={text => { setDraft(text); setError(''); }}
        placeholder="전화번호" placeholderTextColor="#8C99A4" keyboardType="phone-pad" returnKeyType="done" maxLength={25}
        autoFocus editable={!saving} onSubmitEditing={() => void save()} style={s.input} />
      <View style={[s.inline, { gap: 8 }]}>
        <View style={{ flex: 1 }}><CareButton title="취소" secondary disabled={saving} onPress={cancel} /></View>
        <View style={{ flex: 2 }}><CareButton title={saving ? '저장 중…' : '연락처 저장'} disabled={saving || !draft.trim()} onPress={() => void save()} /></View>
      </View>
    </>}
    {!!error && <Text accessibilityRole="alert" style={[s.micro, { color: colors.amber }]}>{error}</Text>}
  </View>;
}
