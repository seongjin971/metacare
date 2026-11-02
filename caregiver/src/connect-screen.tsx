import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Card, Icon, s } from '../../src/ui';
import { CareButton, CarePage, colors } from './components';
import { useCaregiver } from './store';

export function ConnectScreen() {
  const { connect, startDemo, busy, error, clearError, pendingPatient, retryConnectionStorage, cancelPendingConnection } = useCaregiver();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  if (pendingPatient) return <CarePage title="메타케어 보호자">
    <Card style={{ gap: 18 }}>
      <Text accessibilityRole="header" style={s.title}>연결 정보 저장 필요</Text>
      <Text style={s.body}>{pendingPatient}님과의 연결은 만들어졌어요. 기기에 저장을 마쳐야 다음에도 기록을 볼 수 있어요.</Text>
      {error && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{error}</Text>}
      <CareButton title={busy ? '처리 중…' : '저장 다시 시도'} disabled={busy} onPress={() => void retryConnectionStorage()} />
      <CareButton title="연결 취소" secondary disabled={busy} onPress={() => void cancelPendingConnection()} />
      <Text style={s.micro}>완료하기 전에 앱을 닫으면 연결 정보를 잃을 수 있어요. 이미 닫았다면 환자 앱에서 연결을 해제한 뒤 새 코드로 연결해 주세요.</Text>
    </Card>
  </CarePage>;
  return <CarePage title="메타케어 보호자">
    <View style={{ paddingTop: 8, gap: 10 }}>
      <Icon name="people-outline" size={28} color={colors.teal} />
      <Text accessibilityRole="header" style={[s.title, { fontSize: 24, lineHeight: 34 }]}>환자 연결</Text>
      <Text style={s.body}>환자가 공유한 복약 일정과 사진 기록을 확인해요.</Text>
    </View>
    <Card style={{ gap: 18 }}>
      <View><Text style={s.label}>연결 코드</Text><TextInput accessibilityLabel="8자리 연결 코드" value={code} onChangeText={value => { setCode(value.replace(/\D/g, '').slice(0, 8)); clearError(); }} placeholder="8자리 숫자" placeholderTextColor="#8C99A4" keyboardType="number-pad" maxLength={8} autoCorrect={false} editable={!busy} style={[s.input, { letterSpacing: 3, fontSize: 22 }]} />
        <Text style={[s.micro, { marginTop: 8 }]}>환자 앱의 내 관리 → 보호자 연결에서{`\n`}만든 코드를 입력해 주세요.</Text></View>
      <View><Text style={s.label}>보호자 이름</Text><TextInput accessibilityLabel="보호자 이름" value={name} onChangeText={value => { setName(value); clearError(); }} placeholder="환자가 알아볼 수 있는 이름" placeholderTextColor="#8C99A4" maxLength={30} autoCorrect={false} editable={!busy} style={s.input} /></View>
      {error && <Text accessibilityRole="alert" style={[s.body, { color: colors.amber }]}>{error}</Text>}
      <CareButton title={busy ? '연결하는 중…' : '환자와 연결하기'} disabled={busy || code.length !== 8 || !name.trim()} onPress={() => void connect(code, name)} />
    </Card>
    <View style={{ gap: 12 }}><Text style={s.micro}>연결 전에는 공유된 기록이 없어요. 환자의 동의로 연결하며, 환자 또는 보호자가 언제든 연결을 해제할 수 있어요.</Text>
      <CareButton title="예시로 살펴보기" secondary disabled={busy} onPress={startDemo} />
    </View>
  </CarePage>;
}
