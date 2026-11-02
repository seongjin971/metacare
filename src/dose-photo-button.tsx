import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DosePhoto } from './dose-photo';
import { loadDosePhotoUri } from './dose-photo-storage';
import { Button, C, Icon, s } from './ui';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';

export function DosePhotoButton({ photo, label }: { photo: DosePhoto; label: string }) {
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const inset = useSafeAreaInsets();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadDosePhotoUri(photo).then(value => { if (alive) setUri(value); }).catch(() => {
      if (alive) setError('사진을 불러올 수 없어요.');
    });
    return () => { alive = false; };
  }, [open, photo]);

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} 기록 사진 보기`} onPress={() => { setUri(''); setError(''); setOpen(true); }} style={styles.photoButton}>
      <Icon name="image-outline" size={18} />
      <Text style={styles.buttonLabel}>사진</Text>
    </Pressable>
    <Modal visible={open} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
      <View style={[styles.backdrop, { paddingTop: Math.max(20, inset.top), paddingBottom: Math.max(20, inset.bottom) }]}>
        <FadeIn accessibilityViewIsModal style={styles.panel}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={s.section}>{label}</Text>
            <Text style={s.muted}>{new Date(photo.capturedAt).toLocaleString('ko-KR')} 촬영</Text>
            {photo.verification && <Text style={s.micro}>약봉투 문구 확인 · 실제 복용 여부를 확인한 것은 아니에요.</Text>}
          </View>
          <View style={styles.imageArea}>
            {error ? <Text accessibilityRole="alert" style={s.body}>{error}</Text>
              : uri ? <Image source={{ uri }} accessibilityLabel={`${label} 복약 기록 사진`} style={styles.image} resizeMode="contain" onError={() => setError('사진을 불러올 수 없어요.')} />
              : <ActivityIndicator accessibilityLabel="사진 불러오는 중" color={C.blue} />}
          </View>
          <View style={{ padding: 16 }}><Button title="닫기" secondary onPress={() => setOpen(false)} /></View>
        </FadeIn>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  photoButton: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  buttonLabel: { color: C.blue, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#14213b99', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  panel: { width: '100%', maxWidth: 480, maxHeight: '100%', flexShrink: 1, backgroundColor: C.white, borderRadius: 16, overflow: 'hidden' },
  heading: { padding: 16, gap: 6 },
  imageArea: { height: 400, flexShrink: 1, minHeight: 100, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
});
