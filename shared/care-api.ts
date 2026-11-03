import Constants from 'expo-constants';
import { configuredCareEndpoint } from './care-endpoint';

export class CareApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.name = 'CareApiError'; this.status = status; }
}

/** The preview service is local. Installed builds require an explicit HTTPS service. */
export function resolveCareUrl(): string {
  const configured = process.env.EXPO_PUBLIC_CARE_URL;
  if (configured) {
    try { return configuredCareEndpoint(configured, __DEV__); }
    catch (error) { throw new CareApiError(error instanceof Error ? error.message : '복약 공유 서버 주소를 확인해 주세요.'); }
  }
  if (__DEV__) {
    const location = typeof window !== 'undefined' ? window.location : undefined;
    const hostUri = Constants.expoConfig?.hostUri;
    const hostname = location?.hostname || (hostUri ? new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`).hostname : 'localhost');
    const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
    return `http://${host}:8789`;
  }
  throw new CareApiError('연결 서버가 설정되지 않았어요.');
}

export async function careRequest<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  if (!path.startsWith('/v1/')) throw new CareApiError('요청 주소를 확인해 주세요.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${resolveCareUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data.message === 'string' ? data.message : data && typeof data.error === 'string' ? data.error : '연결 요청을 처리하지 못했어요.';
      throw new CareApiError(message, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof CareApiError) throw error;
    throw new CareApiError('연결 서버에 닿지 못했어요. 인터넷 연결과 서버 상태를 확인해 주세요.');
  } finally { clearTimeout(timeout); }
}
