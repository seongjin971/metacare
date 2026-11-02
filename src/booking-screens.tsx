import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { useChat } from './chat';
import { HOSPITAL_NAME } from './hospital';
import { VisitSchedule } from './inline-appointment-booking';
import { C, Icon, Page, s } from './ui';
import { FadeIn, MotionPressable as Pressable } from './motion';
import { useBookingScrollAnchor } from './booking-scroll';

export function AppointmentsScreen() {
  const scrollAnchor = useBookingScrollAnchor();
  return (
    // Android already resizes for the IME. A second height adjustment oscillates
    // with floating handwriting keyboards and repeatedly scrolls the focused input.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'ios'}>
      <Page title="진료 일정" scrollsChildToFocus={false} keyboardDismissMode="on-drag" scrollRef={scrollAnchor.scrollRef} scrollViewProps={scrollAnchor.scrollViewProps}>
        <VisitSchedule scrollAnchor={scrollAnchor} />
      </Page>
    </KeyboardAvoidingView>
  );
}

export function ChatScreen() {
  const { messages, status, sendMessage, retry, pendingIds, error } = useChat('patient');
  const [draft, setDraft] = useState('');
  const listRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const followLatest = useRef(true);
  const connected = status === 'connected';
  const send = () => {
    if (sendMessage(draft.trim())) {
      followLatest.current = true;
      setDraft('');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'ios'}>
      <Page title="상담" scroll={false}>
        <View style={bs.chat}>
          <View style={[s.row, bs.chatHeader]}>
            <Text style={{ color: C.navy, fontSize: 15, fontWeight: '700' }}>{HOSPITAL_NAME}</Text>
          </View>
          <ScrollView
            ref={listRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            scrollEventThrottle={32}
            onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
              followLatest.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 48;
            }}
            onContentSizeChange={() => {
              // Keyboard resizing must not repeatedly animate or pull history down.
              if (followLatest.current) listRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {!messages.length && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={s.muted}>아직 대화가 없어요.</Text></View>}
            {messages.map(message => {
              const mine = message.role === 'patient';
              const pending = pendingIds.includes(message.clientId);
              const timestamp = new Date(message.createdAt);
              return (
                <FadeIn key={message.clientId} style={[bs.messageRow, mine && { justifyContent: 'flex-end' }]}>
                  {!mine && <View accessibilityLabel={`${HOSPITAL_NAME} 프로필`} accessibilityRole="image" style={bs.hospitalAvatar}>
                    <Icon name="medical" size={20} color={C.blue} />
                  </View>}
                  <View style={[bs.messageContent, mine ? bs.myMessageContent : bs.hospitalMessageContent]}>
                    {!mine && <Text style={bs.senderName}>{HOSPITAL_NAME}</Text>}
                    <View style={[bs.bubble, mine ? bs.myBubble : bs.theirBubble]}>
                      <Text selectable style={{ fontSize: 15, lineHeight: 22, color: mine ? 'white' : C.navy }}>{message.text}</Text>
                    </View>
                    <Text style={s.micro}>
                      {pending ? '전송 확인 중' : `${timestamp.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`}
                    </Text>
                  </View>
                </FadeIn>
              );
            })}
          </ScrollView>
          {(!connected || !!error) && (
            <View style={[s.row, bs.connection]}>
              <Text accessibilityRole="alert" style={{ flex: 1, color: '#936b29', fontSize: 12, lineHeight: 18 }}>
                {error || (status === 'connecting' ? '서버에 연결 중이에요.' : '서버와 연결되지 않았어요.')}
              </Text>
              {status === 'offline' && <Pressable accessibilityRole="button" onPress={retry} style={bs.textButton}><Text style={{ color: '#936b29', fontWeight: '700', fontSize: 13 }}>재연결</Text></Pressable>}
            </View>
          )}
          <View style={bs.composer}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <TextInput
                accessibilityLabel="상담 메시지"
                multiline
                maxLength={1000}
                value={draft}
                onChangeText={setDraft}
                placeholder="메시지 입력"
                placeholderTextColor={C.muted}
                style={[s.input, { flex: 1, minHeight: 44, maxHeight: 120 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="메시지 전송"
                accessibilityState={{ disabled: !connected || !draft.trim() }}
                disabled={!connected || !draft.trim()}
                onPress={send}
                style={[bs.send, { backgroundColor: connected && draft.trim() ? C.blue : '#e5eaf3' }]}
              ><Icon name="arrow-up" size={22} color={connected && draft.trim() ? 'white' : C.muted} /></Pressable>
            </View>
            {draft.length >= 900 && <Text style={[s.micro, { textAlign: 'right' }]}>{draft.length} / 1,000</Text>}
          </View>
        </View>
      </Page>
    </KeyboardAvoidingView>
  );
}

const bs = StyleSheet.create({
  textButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  chat: { flex: 1, minHeight: 0, backgroundColor: 'white', borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: 'hidden' },
  chatHeader: { paddingLeft: 16, paddingRight: 6, borderBottomWidth: 1, borderColor: C.line, minHeight: 52 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  hospitalAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' },
  messageContent: { gap: 5 },
  myMessageContent: { maxWidth: '88%', alignItems: 'flex-end' },
  hospitalMessageContent: { flexShrink: 1, alignItems: 'flex-start' },
  senderName: { color: C.navy, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  bubble: { maxWidth: '100%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12 },
  myBubble: { backgroundColor: C.blue, borderBottomRightRadius: 3 },
  theirBubble: { backgroundColor: '#f1f4f8', borderBottomLeftRadius: 3 },
  connection: { paddingLeft: 12, paddingRight: 4, paddingVertical: 4, gap: 8, backgroundColor: '#fff5e5' },
  composer: { padding: 12, gap: 4, borderTopWidth: 1, borderColor: C.line },
  send: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
