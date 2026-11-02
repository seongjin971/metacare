import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { setHospitalContact } from './domain';
import { useCare } from './store';
import { Button, C, Card, Icon, s } from './ui';
import { MotionPressable as Pressable } from './motion';

export function HospitalContactCard() {
  const { state: { hospitalContact: contact }, commit, notify } = useCare();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(contact);
  const [busy, setBusy] = useState(false);

  const edit = () => { setDraft(contact); setEditing(true); };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await commit(current => setHospitalContact(current, draft), '병원 정보를 저장했어요.')) setEditing(false);
    } finally { setBusy(false); }
  };
  const open = async (kind: 'phone' | 'bookingUrl') => {
    try {
      await Linking.openURL(kind === 'phone' ? `tel:${contact.phone}` : contact.bookingUrl);
    } catch {
      notify(kind === 'phone' ? `전화 앱을 열 수 없어요. ${contact.phone}로 전화해 주세요.` : '예약 페이지를 열 수 없어요. 주소를 확인해 주세요.');
    }
  };
  if (!editing && !contact.name) {
    return <Pressable accessibilityRole="button" onPress={edit} style={styles.register}>
      <Icon name="call-outline" size={18} />
      <Text style={styles.registerText}>내 병원 연락처 등록</Text>
      <Icon name="chevron-forward" size={16} color={C.muted} />
    </Pressable>;
  }
  return <Card>
    <View style={s.row}>
      <Text accessibilityRole="header" style={[s.section, { flex: 1 }]}>{editing ? '내 병원 연락처' : contact.name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? '병원 정보 편집 닫기' : '병원 정보 수정'} disabled={busy}
        onPress={editing ? () => setEditing(false) : edit} style={styles.textButton}>
        <Text style={s.muted}>{editing ? '닫기' : '수정'}</Text>
      </Pressable>
    </View>
    {editing ? <>
      <View><Text style={s.label}>병원명</Text><TextInput accessibilityLabel="등록할 병원명" style={s.input} value={draft.name} maxLength={80}
        editable={!busy} onChangeText={name => setDraft(value => ({ ...value, name }))} placeholder="병원 이름" placeholderTextColor={C.muted} /></View>
      <View><Text style={s.label}>전화번호 (선택)</Text><TextInput accessibilityLabel="병원 전화번호" style={s.input} value={draft.phone} maxLength={40}
        editable={!busy} onChangeText={phone => setDraft(value => ({ ...value, phone }))} keyboardType="phone-pad" placeholder="대표 전화번호" placeholderTextColor={C.muted} /></View>
      <View><Text style={s.label}>공식 예약 페이지 (선택)</Text><TextInput accessibilityLabel="병원 공식 예약 페이지 주소" style={s.input} value={draft.bookingUrl} maxLength={2048}
        editable={!busy} onChangeText={bookingUrl => setDraft(value => ({ ...value, bookingUrl }))} keyboardType="url" autoCorrect={false} autoCapitalize="none"
        placeholder="https://" placeholderTextColor={C.muted} /></View>
      <Button title="병원 정보 저장" disabled={busy || (!contact.name && !draft.name.trim())} onPress={() => void save()} />
    </> : <View style={styles.links}>
      {!!contact.phone && <View style={styles.link}><Button title="병원에 전화" icon="call-outline" secondary small onPress={() => void open('phone')} /></View>}
      {!!contact.bookingUrl && <View style={styles.link}><Button title="예약 페이지" icon="open-outline" secondary small onPress={() => void open('bookingUrl')} /></View>}
    </View>}
  </Card>;
}

const styles = StyleSheet.create({
  register: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  registerText: { flex: 1, fontSize: 15, color: C.navy, fontWeight: '600' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { flexGrow: 1, flexBasis: 116 },
});
