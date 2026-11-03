import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceSessionKey } from './care-endpoint';

// Browser preview only. Native device credentials live in SecureStore.
const keyFor = (key: string) => serviceSessionKey(`metacare.preview-session.${key}`, process.env.EXPO_PUBLIC_CARE_URL, __DEV__);
export async function readSession<T>(key: string): Promise<T | null> {
  const value = await AsyncStorage.getItem(keyFor(key));
  return value ? JSON.parse(value) as T : null;
}
export async function writeSession<T>(key: string, value: T): Promise<void> { await AsyncStorage.setItem(keyFor(key), JSON.stringify(value)); }
export async function clearSession(key: string): Promise<void> { await AsyncStorage.removeItem(keyFor(key)); }
