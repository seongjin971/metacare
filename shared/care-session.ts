import * as SecureStore from 'expo-secure-store';
import { serviceSessionKey } from './care-endpoint';

const keyFor = (key: string) => serviceSessionKey(`metacare.${key.replace(/[^A-Za-z0-9._-]/g, '-')}`, process.env.EXPO_PUBLIC_CARE_URL, __DEV__);
export async function readSession<T>(key: string): Promise<T | null> {
  const value = await SecureStore.getItemAsync(keyFor(key));
  return value ? JSON.parse(value) as T : null;
}
export async function writeSession<T>(key: string, value: T): Promise<void> {
  await SecureStore.setItemAsync(keyFor(key), JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function clearSession(key: string): Promise<void> { await SecureStore.deleteItemAsync(keyFor(key)); }
