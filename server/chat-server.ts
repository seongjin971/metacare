/**
 * Local, unauthenticated development chat server. This is one shared DEMO room;
 * it is not connected to a hospital and must never hold real patient information.
 *
 * JSON WebSocket protocol (UTF-8, at most 8 KiB per frame):
 * Client -> {type:'send', clientId, role:'patient'|'hospital', text}
 * Server -> {type:'init', messages:ChatMessage[]}
 *        -> {type:'message', message:ChatMessage}
 *        -> {type:'ack', clientId, message:ChatMessage}
 *        -> {type:'error', clientId?:string, message:string}
 * IDs/timestamps are assigned only by the server. ACK means persisted, not read.
 * clientId is idempotent within the retained 200-message history. Duplicate IDs
 * with different content are rejected. Persistence precedes broadcast and ACK.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';

export type ChatMessage = {
  id: string;
  clientId: string;
  role: 'patient' | 'hospital';
  text: string;
  createdAt: string;
};

type ChatInput = { type: 'send'; clientId: string; role: 'patient' | 'hospital'; text: string };
type Options = { port?: number; host?: string; dataPath?: string };
const MAX_HISTORY = 200;
const MAX_TEXT = 1000;
const MAX_FRAME = 8 * 1024;
const DEFAULT_DATA_PATH = fileURLToPath(new URL('./data/chat.json', import.meta.url));

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function isMessage(value: unknown): value is ChatMessage {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 && isClientId(value.clientId)
    && (value.role === 'patient' || value.role === 'hospital')
    && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= MAX_TEXT
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}

async function loadHistory(dataPath: string): Promise<ChatMessage[]> {
  let contents: string;
  try { contents = await readFile(dataPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.messages)
    || parsed.messages.length > MAX_HISTORY || !parsed.messages.every(isMessage)) {
    throw new Error('Chat history is invalid. Preserve the file and repair it before starting.');
  }
  const messages: ChatMessage[] = parsed.messages;
  if (new Set(messages.map((message) => message.clientId)).size !== messages.length
    || new Set(messages.map((message) => message.id)).size !== messages.length) {
    throw new Error('Chat history contains duplicate IDs.');
  }
  return messages;
}

async function saveHistory(dataPath: string, messages: ChatMessage[]): Promise<void> {
  await mkdir(dirname(dataPath), { recursive: true });
  const temporary = `${dataPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, messages }, null, 2), 'utf8');
  await rename(temporary, dataPath);
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function parseInput(payload: unknown): ChatInput | null {
  if (!record(payload) || payload.type !== 'send' || !isClientId(payload.clientId)
    || (payload.role !== 'patient' && payload.role !== 'hospital')
    || typeof payload.text !== 'string' || payload.text.trim().length === 0 || payload.text.length > MAX_TEXT) return null;
  return { type: 'send', clientId: payload.clientId, role: payload.role, text: payload.text.trim() };
}

export async function startChatServer(options: Options = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
  let history = await loadHistory(dataPath);
  let queue: Promise<void> = Promise.resolve();
  const server = new WebSocketServer({ port: options.port ?? 8787, host: options.host ?? '0.0.0.0', maxPayload: MAX_FRAME });
  await new Promise<void>((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });

  server.on('connection', (socket) => {
    // A bounded queue prevents a single connection from flooding filesystem work.
    let queued = 0;
    send(socket, { type: 'init', messages: history });
    socket.on('error', () => { /* ws emits errors for oversized or invalid frames; it closes the socket. */ });
    socket.on('message', (raw: RawData, binary: boolean) => {
      if (binary) { socket.close(1003, 'JSON text messages only'); return; }
      if (queued >= 20) { socket.close(1008, 'Too many pending messages'); return; }
      let payload: unknown;
      try { payload = JSON.parse(raw.toString()); }
      catch {
        send(socket, { type: 'error', message: '메시지 형식을 읽을 수 없어요.' });
        socket.close(1007, 'Invalid JSON');
        return;
      }
      const input = parseInput(payload);
      if (!input) {
        send(socket, { type: 'error', clientId: record(payload) && isClientId(payload.clientId) ? payload.clientId : undefined, message: '환자 또는 병원 역할에서 1~1,000자의 메시지를 보내 주세요.' });
        return;
      }
      queued += 1;
      queue = queue.then(async () => {
        const existing = history.find((message) => message.clientId === input.clientId);
        if (existing) {
          if (existing.role !== input.role || existing.text !== input.text) {
            send(socket, { type: 'error', clientId: input.clientId, message: '같은 전송 ID에 다른 내용이 있어요. 새 메시지로 보내 주세요.' });
          } else send(socket, { type: 'ack', clientId: input.clientId, message: existing });
          return;
        }
        const message: ChatMessage = { id: randomUUID(), clientId: input.clientId, role: input.role, text: input.text, createdAt: new Date().toISOString() };
        const next = [...history, message].slice(-MAX_HISTORY);
        try { await saveHistory(dataPath, next); }
        catch {
          send(socket, { type: 'error', clientId: input.clientId, message: '서버에 메시지를 저장하지 못했어요. 재연결 후 다시 확인해 주세요.' });
          return;
        }
        history = next;
        for (const client of server.clients) send(client, { type: 'message', message });
        send(socket, { type: 'ack', clientId: input.clientId, message });
      }).finally(() => { queued -= 1; });
      // Keep later messages operational after an unexpected socket-level failure.
      queue = queue.catch(() => send(socket, { type: 'error', clientId: input.clientId, message: '전송을 완료하지 못했어요. 재연결해 주세요.' }));
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Chat server did not expose a TCP address.');
  return {
    port: address.port,
    close: async () => {
      for (const socket of server.clients) socket.terminate();
      await queue;
      await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.CHAT_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CHAT_PORT must be a valid TCP port.');
  const running = await startChatServer({ port });
  console.log(`MetaCare demo chat listening on ws://0.0.0.0:${running.port}`);
  console.log('DEMO ONLY: one shared room, no authentication, no real patient information.');
  const shutdown = () => { void running.close().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
