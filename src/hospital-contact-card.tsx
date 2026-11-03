import React, { useCallback, useRef, useState } from 'react';
import { Keyboard, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { hospitalNames, selectHospital, setHospitalContact, type HospitalContact } from './domain';
import { useCare } from './store';
import { Button, C, Card, Icon, s, useInlineEditorBack } from './ui';
import { MotionPressable as Pressable } from './motion';

function displayPhone(phone: string) {
  return phone
    .replace(/^(02|050\d|0303|0[1-9]\d)(\d{3,4})(\d{4})$/, '$1-$2-$3')
    .replace(/^(1\d{3})(\d{4})$/, '$1-$2');
}

function checkTarget(expected: HospitalContact, current: HospitalContact) {
  if (expected.name !== current.name || expected.phone !== current.phone || expected.bookingUrl !== current.bookingUrl) {
    throw new Error('다른 화면에서 병원 정보가 바뀌었어요. 병원 정보를 다시 열어 주세요.');
  }
}

export function HospitalContactCard({ editable }: { editable: boolean }) {
  const { state, commit, confirm, notify, sample } = useCare();
  const contact = state.hospitalContact;
  const [mode, setMode] = useState<'view' | 'choose' | 'create' | 'edit'>('view');
  const editing = mode === 'edit' || mode === 'create';
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(contact);
  const editingContact = useRef(contact);
  const [busy, setBusy] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneField = useRef<React.ComponentRef<typeof TextInput>>(null);
  const saving = useRef(false);

  const names = mode === 'choose' ? hospitalNames(state) : [];
  const edit = () => { editingContact.current = contact; setDraft(contact); setPhoneTouched(false); setMode('edit'); };
  const create = (name = '') => { setDraft({ name, phone: '', bookingUrl: '' }); setPhoneTouched(false); setMode('create'); };
  const choose = () => {
    setQuery('');
    if (hospitalNames(state).length) setMode('choose'); else create();
  };
  const cancel = useCallback(() => {
    if (saving.current) return;
    Keyboard.dismiss();
    setMode(mode === 'create' && hospitalNames(state).length ? 'choose' : 'view');
  }, [mode, state]);
  useInlineEditorBack(mode !== 'view', cancel);
  const phoneDigits = draft.phone.trim().replace(/[ ()-]/g, '');
  const validPhone = !draft.phone.trim() || /^\+?\d{7,15}$/.test(phoneDigits);
  const changed = mode === 'create' || draft.name.trim() !== contact.name || phoneDigits !== contact.phone;
  const select = async (name: string, phone?: string) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const saved = await commit(current => selectHospital(current, name, phone), '내 병원을 설정했어요.');
      if (saved) { Keyboard.dismiss(); setMode('view'); }
    } finally { saving.current = false; setBusy(false); }
  };
  const save = async () => {
    if (saving.current || !changed || !draft.name.trim() || !validPhone) return;
    if (mode === 'create') return select(draft.name, draft.phone);
    saving.current = true;
    setBusy(true);
    try {
      const saved = await commit(current => {
        checkTarget(editingContact.current, current.hospitalContact);
        return setHospitalContact(current, { name: draft.name, phone: draft.phone,
          bookingUrl: draft.name.trim() === current.hospitalContact.name ? current.hospitalContact.bookingUrl : '' });
      }, '병원 연락처를 저장했어요.');
      if (saved) { Keyboard.dismiss(); setMode('view'); }
    } finally { saving.current = false; setBusy(false); }
  };
  const askDelete = () => {
    Keyboard.dismiss();
    const target = editingContact.current;
    confirm({
      title: '병원 연락처를 삭제할까요?', body: `${target.name} 연락처를 삭제합니다. 저장한 진료 일정은 유지돼요.`,
      label: '연락처 삭제', cancelLabel: '연락처 유지', destructive: true,
      onConfirm: async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
          const saved = await commit(current => {
            checkTarget(target, current.hospitalContact);
            return setHospitalContact(current, { name: '', phone: '', bookingUrl: '' });
          }, '병원 연락처를 삭제했어요.');
          if (saved) setMode('view');
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
  if (mode === 'view' && !contact.name) {
    return <Pressable accessibilityRole="button" accessibilityLabel={editable ? '내 병원 연락처 등록' : '내 병원 선택'} onPress={editable ? edit : choose} style={styles.register}>
      <Icon name={editable ? 'call-outline' : 'medical-outline'} size={18} />
      <Text style={styles.registerText}>{editable ? '내 병원 연락처 등록' : '내 병원 선택'}</Text>
      <Icon name="chevron-forward" size={16} color={C.muted} />
    </Pressable>;
  }
  if (mode === 'choose') return <Card>
    <View style={s.row}>
      <Text accessibilityRole="header" style={s.section}>내 병원 선택</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="병원 선택 닫기" disabled={busy} onPress={cancel} style={styles.textButton}><Text style={s.body}>닫기</Text></Pressable>
    </View>
    {names.length > 5 && <TextInput accessibilityLabel="저장한 병원 찾기" value={query} onChangeText={setQuery}
      style={s.input} placeholder="병원 이름으로 찾기" placeholderTextColor={C.muted} />}
    {names.filter(name => name.includes(query.trim())).map(name =>
      <Pressable key={name} accessibilityRole="button" accessibilityLabel={`${name} 선택`} accessibilityState={{ selected: name === contact.name, disabled: busy }}
        onPress={name === contact.name ? cancel : () => void select(name)} disabled={busy} style={styles.choice}>
        <Text style={styles.registerText}>{name}</Text>
        <Icon name={name === contact.name ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={name === contact.name ? C.blue : C.muted} />
      </Pressable>)}
    <Button title="새 병원 등록" icon="add" secondary disabled={busy} onPress={() => create(query.trim())} />
  </Card>;
  return <Card>
    <View style={s.row}>
      <View style={{ flex: 1, gap: 3 }}>
        {!editable && !editing && <Text style={s.muted}>내 병원</Text>}
        <Text accessibilityRole="header" style={s.section}>{mode === 'create' ? '새 병원 등록' : editable ? '내 병원 연락처' : contact.name}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? '병원 입력 취소' : editable ? '병원 정보 수정' : '내 병원 변경'} disabled={busy}
        onPress={editing ? cancel : editable ? edit : choose} style={styles.textButton}>
        <Text style={editing ? s.body : styles.action}>{editing ? '취소' : editable ? '수정' : '변경'}</Text>
      </Pressable>
    </View>
    {editing ? <>
      <View><Text style={s.label}>병원명</Text><TextInput accessibilityLabel="등록할 병원명" style={s.input} value={draft.name} maxLength={80}
        editable={!busy} onChangeText={name => setDraft(value => ({ ...value, name }))} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => phoneField.current?.focus()} placeholder="병원 이름" placeholderTextColor={C.muted} /></View>
      <View><Text style={s.label}>전화번호 (선택)</Text><TextInput ref={phoneField} accessibilityLabel="병원 전화번호" style={s.input} value={draft.phone} maxLength={40}
        editable={!busy} onChangeText={phone => setDraft(value => ({ ...value, phone }))} onBlur={() => setPhoneTouched(true)}
        keyboardType="phone-pad" returnKeyType="done" placeholder="대표 전화번호" placeholderTextColor={C.muted} /></View>
      {phoneTouched && !!draft.phone && !validPhone && <Text accessibilityLiveRegion="polite" style={styles.error}>전화번호를 숫자 7~15자리로 입력해 주세요.</Text>}
      <Button title={busy ? '처리 중…' : mode === 'create' ? '내 병원으로 선택' : '병원 연락처 저장'} disabled={busy || !changed || !draft.name.trim() || !validPhone} onPress={() => void save()} />
      {mode === 'edit' && !!contact.name && <Pressable accessibilityRole="button" accessibilityLabel="병원 연락처 삭제" disabled={busy}
        onPress={askDelete} style={[styles.textButton, { alignSelf: 'flex-start' }]}><Text style={styles.error}>연락처 삭제</Text></Pressable>}
    </> : <>
      {editable && <Text style={s.body}>{contact.name}</Text>}
      {!!contact.phone && <Text selectable style={s.body}>대표번호 {displayPhone(contact.phone)}</Text>}
      {!sample && (!!contact.phone || (!editable && !!contact.bookingUrl)) && <View style={styles.links}>
        {!!contact.phone && <View style={styles.link}><Button title="병원에 전화" icon="call-outline" secondary small onPress={() => void open('phone')} /></View>}
        {!editable && !!contact.bookingUrl && <View style={styles.link}><Button title="예약 페이지 열기" icon="open-outline" secondary small onPress={() => void open('bookingUrl')} /></View>}
      </View>}
    </>}
  </Card>;
}

const styles = StyleSheet.create({
  register: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  registerText: { flex: 1, fontSize: 15, color: C.navy, fontWeight: '600' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderBottomWidth: 1, borderColor: C.line },
  action: { color: C.blue, fontWeight: '600', fontSize: 14 },
  error: { color: '#a13b35', fontSize: 13, lineHeight: 20 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { flexGrow: 1, flexBasis: 116 },
});
