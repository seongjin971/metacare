import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Role } from './domain';

/** One shared, unauthenticated local demo room. Never enter real patient data. */
export type ChatMessage = {
  id: string;
  clientId: string;
  role: 'patient' | 'hospital';
  text: string;
  createdAt: string;
};
export type ChatStatus = 'connecting' | 'connected' | 'offline';
type Pending = { message: ChatMessage; timer?: ReturnType<typeof setTimeout> };

export function getChatUrl(): string {
  const override = process.env.EXPO_PUBLIC_CHAT_URL;
  if (override) {
    const url = new URL(override);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('채팅 주소는 ws:// 또는 wss://로 시작해야 해요.');
    return url.toString();
  }
  // In Expo Go hostUri points at the development computer, not at the phone.
  const browserLocation = typeof window !== 'undefined' ? window.location : undefined;
  if (browserLocation?.hostname) {
    const scheme = browserLocation.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = browserLocation.hostname.includes(':') && !browserLocation.hostname.startsWith('[') ? `[${browserLocation.hostname}]` : browserLocation.hostname;
    return `${scheme}://${hostname}:8787`;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const url = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`);
    return `ws://${url.hostname}:8787`;
  }
  throw new Error('채팅 서버 주소를 찾지 못했어요. 개발 서버로 실행하거나 EXPO_PUBLIC_CHAT_URL을 설정해 주세요.');
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.clientId === 'string'
    && (item.role === 'patient' || item.role === 'hospital')
    && typeof item.text === 'string' && item.text.length <= 1000
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt));
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byClient = new Map(existing.map((message) => [message.clientId, message]));
  for (const message of incoming) byClient.set(message.clientId, message);
  return [...byClient.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200);
}

/**
 * sendMessage=false means nothing was queued: callers must keep their draft.
 * pendingIds contains client IDs whose persistence has not yet been confirmed.
 * A disconnect keeps those IDs pending and retries them idempotently on reconnect.
 * ACK confirms server storage only; it is never a hospital-read receipt.
 * Pending attempts live in memory; accepted history is persisted by the server.
 */
export function useChat(role: Role): {
  messages: ChatMessage[];
  status: ChatStatus;
  sendMessage: (text: string) => boolean;
  retry: () => void;
  pendingIds: string[];
  error: string;
} {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [error, setError] = useState('');
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<ChatStatus>('connecting');
  const pendingRef = useRef(new Map<string, Pending>());

  const refreshPending = useCallback(() => setPendingIds([...pendingRef.current.keys()]), []);
  const setConnectionStatus = useCallback((value: ChatStatus) => {
    statusRef.current = value;
    setStatus(value);
  }, []);

  const armPendingTimeout = useCallback((clientId: string) => {
    const pending = pendingRef.current.get(clientId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (pendingRef.current.has(clientId)) setError('서버의 전송 확인이 지연되고 있어요. 재연결하면 같은 메시지의 전송 여부를 확인해요.');
    }, 10000);
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let activeSocket: WebSocket | null = null;
    if (role === 'caregiver') return;

    const resolvePending = (message: ChatMessage) => {
      const pending = pendingRef.current.get(message.clientId);
      if (pending?.timer) clearTimeout(pending.timer);
      pendingRef.current.delete(message.clientId);
      refreshPending();
    };

    const connect = () => {
      if (disposed) return;
      setConnectionStatus('connecting');
      let socket: WebSocket;
      try { socket = new WebSocket(getChatUrl()); }
      catch (cause) {
        setConnectionStatus('offline');
        setError(cause instanceof Error ? cause.message : '채팅 서버에 연결하지 못했어요.');
        return;
      }
      activeSocket = socket;
      socketRef.current = socket;
      connectTimer = setTimeout(() => {
        if (!disposed && statusRef.current !== 'connected') {
          setError('채팅 서버에 연결하지 못했어요. 같은 Wi-Fi와 채팅 서버 실행 상태를 확인해 주세요.');
          socket.close();
        }
      }, 8000);
      socket.onmessage = (event) => {
        if (disposed || socket !== activeSocket) return;
        let payload: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
          payload = parsed as Record<string, unknown>;
        } catch { setError('서버 응답을 읽지 못했어요. 재연결해 주세요.'); return; }
        if (payload.type === 'init' && Array.isArray(payload.messages) && payload.messages.length <= 200 && payload.messages.every(isMessage)) {
          if (connectTimer) clearTimeout(connectTimer);
          failures = 0;
          for (const message of payload.messages) resolvePending(message);
          const unconfirmed = [...pendingRef.current.values()].map((pending) => pending.message);
          setMessages(mergeMessages(payload.messages, unconfirmed));
          setConnectionStatus('connected');
          setError('');
          for (const pending of pendingRef.current.values()) {
            const message = pending.message;
            try {
              socket.send(JSON.stringify({ type: 'send', clientId: message.clientId, role: message.role, text: message.text }));
              armPendingTimeout(message.clientId);
            } catch { socket.close(); break; }
          }
        } else if ((payload.type === 'message' || payload.type === 'ack') && isMessage(payload.message)) {
          resolvePending(payload.message);
          setMessages((current) => mergeMessages(current, [payload.message as ChatMessage]));
          if (!pendingRef.current.size) setError('');
        } else if (payload.type === 'error' && typeof payload.message === 'string') {
          // Retain unconfirmed text and its pending marker; never imply delivery.
          setError(payload.message);
        }
      };
      socket.onerror = () => {
        if (!disposed) setError('채팅 연결을 확인해 주세요. 실제 병원 연결이 아닌 개발용 채팅 서버예요.');
      };
      socket.onclose = () => {
        if (disposed || socket !== activeSocket) return;
        if (connectTimer) clearTimeout(connectTimer);
        socketRef.current = null;
        setConnectionStatus('offline');
        setError(pendingRef.current.size
          ? '연결이 끊겨 전송 여부를 아직 확인하지 못했어요. 재연결되면 확인할게요.'
          : '채팅 서버 연결이 끊겼어요. 같은 Wi-Fi와 서버 실행 상태를 확인해 주세요.');
        failures += 1;
        reconnectTimer = setTimeout(connect, Math.min(2000 * failures, 10000));
      };
    };
    const initialConnect = setTimeout(connect, 0);
    const pending = pendingRef.current;
    return () => {
      disposed = true;
      clearTimeout(initialConnect);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connectTimer) clearTimeout(connectTimer);
      for (const item of pending.values()) if (item.timer) clearTimeout(item.timer);
      if (activeSocket) {
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        activeSocket.onmessage = null;
        activeSocket.close();
      }
      socketRef.current = null;
    };
  }, [role, retryKey, armPendingTimeout, refreshPending, setConnectionStatus]);

  const sendMessage = useCallback((text: string): boolean => {
    const currentRole = role;
    if (currentRole === 'caregiver') { setError('보호자는 예약 상담 메시지를 보낼 수 없어요.'); return false; }
    const normalized = text.trim();
    if (!normalized || normalized.length > 1000) { setError('메시지를 1~1,000자로 입력해 주세요.'); return false; }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || statusRef.current !== 'connected') {
      setError('서버에 연결되면 보낼 수 있어요. 작성한 내용은 그대로 남아 있어요.');
      return false;
    }
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const message: ChatMessage = { id: `pending-${clientId}`, clientId, role: currentRole, text: normalized, createdAt: new Date().toISOString() };
    try { socket.send(JSON.stringify({ type: 'send', clientId, role: currentRole, text: normalized })); }
    catch {
      setError('전송하지 못했어요. 작성한 내용을 확인하고 다시 보내 주세요.');
      return false;
    }
    pendingRef.current.set(clientId, { message });
    refreshPending();
    setMessages((current) => mergeMessages(current, [message]));
    setError('');
    armPendingTimeout(clientId);
    return true;
  }, [role, armPendingTimeout, refreshPending]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return {
    messages: role === 'caregiver' ? [] : messages,
    status: role === 'caregiver' ? 'offline' : status,
    sendMessage,
    retry,
    pendingIds: role === 'caregiver' ? [] : pendingIds,
    error: role === 'caregiver' ? '예약 상담은 환자와 병원 역할에서 이용할 수 있어요.' : error,
  };
}
