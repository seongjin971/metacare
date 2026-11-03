import React, { useCallback, useRef, useState } from 'react';
import { Keyboard, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { setHospitalContact } from './domain';
import { useCare } from './store';
import { Button, C, Card, Icon, s, useInlineEditorBack } from './ui';
import { MotionPressable as Pressable } from './motion';

function displayPhone(phone: string) {
  return phone
    .replace(/^(02|050\d|0303|0[1-9]\d)(\d{3,4})(\d{4})$/, '$1-$2-$3')
    .replace(/^(1\d{3})(\d{4})$/, '$1-$2');
}

export function HospitalContactCard({ editable }: { editable: boolean }) {
  const { state: { hospitalContact: contact }, commit, confirm, notify } = useCare();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(contact);
  const [busy, setBusy] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneField = useRef<React.ComponentRef<typeof TextInput>>(null);
  const saving = useRef(false);

  const edit = () => { setDraft(contact); setPhoneTouched(false); setEditing(true); };
  const cancel = useCallback(() => {
    if (saving.current) return;
    Keyboard.dismiss();
    setEditing(false);
  }, []);
  useInlineEditorBack(editing, cancel);
  const phoneDigits = draft.phone.trim().replace(/[ ()-]/g, '');
  const validPhone = /^\+?\d{7,15}$/.test(phoneDigits);
  const changed = draft.name.trim() !== contact.name || phoneDigits !== contact.phone;
  const save = async () => {
    if (saving.current || !changed || !draft.name.trim() || !validPhone) return;
    saving.current = true;
    setBusy(true);
    try {
      const saved = await commit(current => setHospitalContact(current, {
        name: draft.name,
        phone: draft.phone,
        bookingUrl: draft.name.trim() === current.hospitalContact.name ? current.hospitalContact.bookingUrl : '',
      }), '병원 연락처를 저장했어요.');
      if (saved) { Keyboard.dismiss(); setEditing(false); }
    } finally { saving.current = false; setBusy(false); }
  };
  const askDelete = () => {
    Keyboard.dismiss();
    confirm({
      title: '병원 연락처를 삭제할까요?', body: `${contact.name} 연락처를 삭제합니다. 저장한 진료 일정은 유지돼요.`,
      label: '연락처 삭제', cancelLabel: '연락처 유지', destructive: true,
      onConfirm: async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
          const saved = await commit(current => setHospitalContact(current, { name: '', phone: '', bookingUrl: '' }), '병원 연락처를 삭제했어요.');
          if (saved) setEditing(false);
        } finally { saving.current = false; setBusy(false); }
      },
    });
  };
  const open = async (kind: 'phone' | 'bookingUrl') => {
    try {
      await Linking.openURL(kind === 'phone' ? `tel:${contact.phone}` : contact.bookingUrl);
    } catch {
      notify(kind === 'phone' ? `전화 앱을 열 수 없어요. ${contact.phone}로 전화해 주세요.` : '예약 페이지를 열 수 없어요. 주소를 확인해 주세요.');
    }
  };
  if (!editing && !contact.name) {
    if (!editable) return null;
    return <Pressable accessibilityRole="button" onPress={edit} style={styles.register}>
      <Icon name="call-outline" size={18} />
      <Text style={styles.registerText}>내 병원 연락처 등록</Text>
      <Icon name="chevron-forward" size={16} color={C.muted} />
    </Pressable>;
  }
  return <Card>
    <View style={s.row}>
      <Text accessibilityRole="header" style={[s.section, { flex: 1 }]}>{editable ? '내 병원 연락처' : contact.name}</Text>
      {editable && <Pressable accessibilityRole="button" accessibilityLabel={editing ? '병원 연락처 입력 취소' : '병원 정보 수정'} disabled={busy}
        onPress={editing ? cancel : edit} style={styles.textButton}>
        <Text style={s.body}>{editing ? '취소' : '수정'}</Text>
      </Pressable>}
    </View>
    {editing ? <>
      <View><Text style={s.label}>병원명</Text><TextInput accessibilityLabel="등록할 병원명" style={s.input} value={draft.name} maxLength={80}
        editable={!busy} onChangeText={name => setDraft(value => ({ ...value, name }))} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => phoneField.current?.focus()} placeholder="병원 이름" placeholderTextColor={C.muted} /></View>
      <View><Text style={s.label}>전화번호</Text><TextInput ref={phoneField} accessibilityLabel="병원 전화번호" style={s.input} value={draft.phone} maxLength={40}
        editable={!busy} onChangeText={phone => setDraft(value => ({ ...value, phone }))} onBlur={() => setPhoneTouched(true)}
        keyboardType="phone-pad" returnKeyType="done" placeholder="대표 전화번호" placeholderTextColor={C.muted} /></View>
      {phoneTouched && !!draft.phone && !validPhone && <Text accessibilityLiveRegion="polite" style={styles.error}>전화번호를 숫자 7~15자리로 입력해 주세요.</Text>}
      <Button title={busy ? '처리 중…' : '병원 연락처 저장'} disabled={busy || !changed || !draft.name.trim() || !validPhone} onPress={() => void save()} />
      {!!contact.name && <Pressable accessibilityRole="button" accessibilityLabel="병원 연락처 삭제" disabled={busy}
        onPress={askDelete} style={[styles.textButton, { alignSelf: 'flex-start' }]}><Text style={styles.error}>연락처 삭제</Text></Pressable>}
    </> : <>
      {editable && <Text style={s.body}>{contact.name}</Text>}
      {!!contact.phone && <Text selectable style={s.body}>대표번호 {displayPhone(contact.phone)}</Text>}
      <View style={styles.links}>
        {!!contact.phone && <View style={styles.link}><Button title="병원에 전화" icon="call-outline" secondary small onPress={() => void open('phone')} /></View>}
        {!editable && !!contact.bookingUrl && <View style={styles.link}><Button title="예약 페이지 열기" icon="open-outline" secondary small onPress={() => void open('bookingUrl')} /></View>}
      </View>
    </>}
  </Card>;
}

const styles = StyleSheet.create({
  register: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  registerText: { flex: 1, fontSize: 15, color: C.navy, fontWeight: '600' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  error: { color: '#a13b35', fontSize: 13, lineHeight: 20 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { flexGrow: 1, flexBasis: 116 },
});
