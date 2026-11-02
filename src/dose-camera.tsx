import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Image, Linking, Modal, Platform,
  StyleSheet, Text, View,
} from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, C, Icon, s } from './ui';
import { verifyDosePhoto, type DoseCapture, type VerifiedDoseCapture } from './verify-dose-photo';
import { FadeIn, MotionPressable as Pressable, useReducedMotion } from './motion';

type Props = {
  label: string;
  onClose: () => void;
  onSave: (capture: VerifiedDoseCapture, canCommit: () => boolean) => Promise<boolean>;
};

/** A new live-camera capture is the only route to the save callback. */
export function DoseCamera({ label, onClose, onSave }: Props) {
  const reducedMotion = useReducedMotion();
  const inset = useSafeAreaInsets();
  const camera = useRef<CameraView | null>(null);
  const alive = useRef(true);
  const active = useRef(AppState.currentState === 'active');
  const captureSession = useRef(0);
  const busyRef = useRef<'permission' | 'capture' | 'verify' | 'save' | null>(null);
  const [busy, setBusy] = useState<typeof busyRef.current>(null);
  const [permission, requestPermission, getPermission] = useCameraPermissions({ get: false });
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [mountFailed, setMountFailed] = useState(false);
  const [error, setError] = useState('');
  const [capture, setCapture] = useState<DoseCapture | null>(null);

  const checkPermission = useCallback(async () => {
    try { await getPermission(); }
    catch {
      // Some browsers cannot query camera permission. The explicit request still works.
    } finally { if (alive.current) setCheckingPermission(false); }
  }, [getPermission]);

  useEffect(() => {
    alive.current = true;
    void checkPermission();
    const subscription = AppState.addEventListener('change', state => {
      const isActive = state === 'active';
      active.current = isActive;
      setForeground(isActive);
      setReady(false);
      if (!isActive) {
        captureSession.current += 1;
        if (busyRef.current === 'verify' || busyRef.current === 'capture') setError('촬영이 중단됐어요. 다시 촬영해 주세요.');
      }
      else void checkPermission();
    });
    return () => {
      alive.current = false;
      captureSession.current += 1;
      subscription.remove();
    };
  }, [checkPermission]);

  const close = () => {
    if (busyRef.current === 'save') return;
    alive.current = false;
    captureSession.current += 1;
    onClose();
  };

  const requestCamera = async () => {
    if (busyRef.current) return;
    busyRef.current = 'permission';
    setBusy('permission');
    setError('');
    try {
      const result = await requestPermission();
      if (!alive.current) return;
      if (!result.granted) {
        setError(Platform.OS === 'web'
          ? '카메라를 사용할 수 없어요. 기기 연결과 브라우저의 카메라 권한을 확인해 주세요.'
          : '카메라 권한을 허용해야 사진으로 기록할 수 있어요.');
      }
      setMountFailed(false);
      setReady(false);
      setCameraKey(value => value + 1);
    } catch {
      if (alive.current) setError('카메라를 사용할 수 없어요. 기기 연결과 카메라 권한을 확인해 주세요.');
    } finally {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    }
  };

  const takePhoto = async () => {
    if (busyRef.current || !ready || !camera.current || !active.current || capture) return;
    busyRef.current = 'capture';
    setBusy('capture');
    setError('');
    const session = captureSession.current;
    const isCurrent = () => alive.current && active.current && session === captureSession.current;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.85, exif: false, imageType: 'jpg' });
      if (!isCurrent()) return;
      if (!photo?.uri || !Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width <= 0 || photo.height <= 0) {
        throw new Error('empty capture');
      }
      const captured = { uri: photo.uri, width: photo.width, height: photo.height, capturedAt: new Date().toISOString() };
      setCapture(captured);
      setReady(false);
      busyRef.current = 'verify';
      setBusy('verify');
      const result = await verifyDosePhoto(captured);
      if (!isCurrent()) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      busyRef.current = 'save';
      setBusy('save');
      const saved = await onSave(result.capture, isCurrent);
      // Once the durable write has completed, a background transition cannot
      // undo it. Close the still-mounted camera to match the committed record.
      if (!alive.current) return;
      if (saved) onClose();
      else setError('사진은 확인했지만 기록을 저장하지 못했어요. 다시 촬영해 주세요.');
    } catch {
      if (isCurrent()) setError('사진을 처리하지 못했어요. 다시 촬영해 주세요.');
    } finally {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    }
  };

  const retake = () => {
    if (busyRef.current) return;
    captureSession.current += 1;
    setCapture(null);
    setReady(false);
    setMountFailed(false);
    setError('');
    setCameraKey(value => value + 1);
  };

  const cameraVisible = permission?.granted && !capture && foreground && !mountFailed && busy !== 'permission';
  const permissionBlocked = permission?.canAskAgain === false && !permission.granted;

  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <View style={[styles.backdrop, { paddingTop: Math.max(16, inset.top), paddingBottom: Math.max(16, inset.bottom) }]}>
        <View accessibilityViewIsModal accessibilityLabel="복약 사진 촬영" style={styles.panel}>
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text accessibilityRole="header" style={styles.title}>약봉투 촬영</Text>
              <Text style={s.muted}>{label}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="촬영 취소" disabled={busy === 'save'} accessibilityState={{ disabled: busy === 'save' }} onPress={close} style={styles.close}>
              <Icon name="close" color={busy === 'save' ? C.muted : C.navy} />
            </Pressable>
          </View>
          <View style={[styles.stage, (cameraVisible || !!capture) && styles.darkStage]}>
            {capture ? (
              <Image source={{ uri: capture.uri }} accessibilityLabel="촬영한 복약 사진" style={styles.preview} resizeMode="contain" />
            ) : cameraVisible ? (
              <>
                <CameraView
                  key={cameraKey}
                  ref={camera}
                  style={StyleSheet.absoluteFill}
                  facing={facing}
                  mode="picture"
                  flash="off"
                  mute
                  autofocus="on"
                  onCameraReady={() => { if (alive.current && active.current) setReady(true); }}
                  onMountError={() => {
                    if (!alive.current) return;
                    setReady(false);
                    setMountFailed(true);
                    setError('카메라를 사용할 수 없어요. 다른 앱에서 사용 중인지와 카메라 권한을 확인해 주세요.');
                  }}
                />
                {!ready && <View style={styles.center}><ActivityIndicator color="white" /><Text style={styles.loading}>카메라 준비 중…</Text></View>}
              </>
            ) : (
              <View style={styles.center}>
                {checkingPermission || busy === 'permission' ? <ActivityIndicator color={C.blue} /> : <Icon name="camera-outline" size={42} color={C.muted} />}
                <Text style={styles.message}>
                  {checkingPermission ? '카메라를 확인하고 있어요.'
                    : !foreground ? '앱으로 돌아오면 촬영을 이어갈 수 있어요.'
                      : mountFailed ? '카메라를 사용할 수 없어요.'
                        : permissionBlocked ? '휴대폰 설정에서 카메라 권한을 허용해 주세요.'
                          : '작은 약봉투의 복용 시간과 식전·식후 표시가 보이도록 촬영해 주세요.'}
                </Text>
                {!checkingPermission && foreground && !permission?.granted && (
                  <Button
                    title={busy === 'permission' ? '권한 확인 중…' : permissionBlocked && Platform.OS !== 'web' ? '휴대폰 설정 열기' : '카메라 허용'}
                    disabled={!!busy}
                    onPress={() => {
                      if (permissionBlocked && Platform.OS !== 'web') {
                        void Linking.openSettings().catch(() => { if (alive.current) setError('휴대폰 설정에서 메타케어의 카메라 권한을 켜 주세요.'); });
                      } else void requestCamera();
                    }}
                  />
                )}
                {mountFailed && permission?.granted && foreground && <Button title="다시 시도" secondary onPress={retake} />}
              </View>
            )}
          </View>
          <View style={styles.footer}>
            {!!error && <FadeIn motionKey={error} style={{ gap: 4 }}><Text style={styles.failureTitle}>사진 인증 미완료</Text><Text accessibilityRole="alert" style={styles.error}>{error}</Text></FadeIn>}
            {capture ? (
              busy ? <View accessibilityLiveRegion="polite" style={styles.processing}>
                <ActivityIndicator color={C.blue} />
                <Text style={styles.processingText}>{busy === 'save' ? '기록 저장 중…' : '약봉투 확인 중…'}</Text>
              </View> : <Button title="다시 촬영" icon="camera-outline" onPress={retake} />
            ) : (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel="카메라 전환"
                  accessibilityState={{ disabled: !cameraVisible || !!busy }} disabled={!cameraVisible || !!busy}
                  onPress={() => { setReady(false); setFacing(value => value === 'back' ? 'front' : 'back'); }}
                  style={styles.flip}
                ><Icon name="camera-reverse-outline" color={cameraVisible && !busy ? C.blue : C.muted} /></Pressable>
                <View style={{ flex: 1 }}><Button title={busy === 'capture' ? '촬영 중…' : '사진 촬영'} icon="camera-outline" disabled={!cameraVisible || !ready || !!busy} onPress={() => void takePhoto()} /></View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#14213b66', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  panel: { width: '100%', maxWidth: 480, height: '90%', maxHeight: 760, backgroundColor: C.white, borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  title: { color: C.navy, fontSize: 20, fontWeight: '700' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 160, backgroundColor: C.bg, overflow: 'hidden' },
  darkStage: { backgroundColor: '#132036' },
  preview: { width: '100%', height: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  message: { fontSize: 15, lineHeight: 24, color: C.navy, textAlign: 'center' },
  loading: { color: C.white, fontSize: 14 },
  footer: { padding: 16, gap: 12 },
  processing: { minHeight: 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  processingText: { color: C.navy, fontSize: 15, fontWeight: '600' },
  failureTitle: { color: C.navy, fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flip: { width: 48, height: 48, borderRadius: 9, backgroundColor: C.pale, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#b04444', fontSize: 13, lineHeight: 20 },
});
