import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { startChatServer } from '../server/chat-server.ts';
import type { ChatMessage } from '../server/chat-server.ts';

type Packet =
  | { type: 'init'; messages: ChatMessage[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'ack'; clientId: string; message: ChatMessage }
  | { type: 'error'; clientId?: string; message: string };

async function removeTestDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`) && basename(target).startsWith('metacare-chat-'));
  await rm(target, { recursive: true, force: true });
}

function client(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const packets: Packet[] = [];
  const waiting: { type: string; resolve: (packet: Packet) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  socket.on('error', () => {});
  socket.on('message', (data) => {
    const packet = JSON.parse(data.toString()) as Packet;
    const index = waiting.findIndex((item) => item.type === packet.type);
    if (index < 0) { packets.push(packet); return; }
    const item = waiting.splice(index, 1)[0];
    clearTimeout(item.timer);
    item.resolve(packet);
  });
  const next = <Type extends Packet['type']>(type: Type): Promise<Extract<Packet, { type: Type }>> => {
    const index = packets.findIndex((packet) => packet.type === type);
    if (index >= 0) return Promise.resolve(packets.splice(index, 1)[0] as Extract<Packet, { type: Type }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3000);
      waiting.push({ type, resolve: (packet) => resolve(packet as Extract<Packet, { type: Type }>), timer });
    });
  };
  return { socket, next, packets };
}

test('chat persists and broadcasts real messages, deduplicates retries and restores history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metacare-chat-'));
  const dataPath = join(directory, 'chat.json');
  let server = await startChatServer({ port: 0, host: '127.0.0.1', dataPath });
  try {
    const patient = client(server.port);
    const hospital = client(server.port);
    assert.deepEqual((await patient.next('init')).messages, []);
    await hospital.next('init');
    const payload = { type: 'send', clientId: 'patient-message-001', role: 'patient', text: '오후 예약이 가능한가요?' };
    patient.socket.send(JSON.stringify(payload));
    const received = await hospital.next('message');
    const ack = await patient.next('ack');
    assert.equal(received.message.text, payload.text);
    assert.equal(ack.message.id, received.message.id);
    assert.ok(Number.isFinite(Date.parse(ack.message.createdAt)));
    assert.equal(JSON.parse(await readFile(dataPath, 'utf8')).messages.length, 1);
    patient.socket.send(JSON.stringify(payload));
    assert.equal((await patient.next('ack')).message.id, ack.message.id);
    patient.socket.send(JSON.stringify({ ...payload, text: '다른 내용' }));
    assert.match((await patient.next('error')).message, /다른 내용/);
    hospital.socket.send(JSON.stringify({ type: 'send', clientId: 'hospital-reply-001', role: 'hospital', text: '예시 병원입니다. 예약 화면에서 확인해 주세요.' }));
    const reply = await hospital.next('ack');
    assert.equal(reply.message.role, 'hospital');
    await server.close();
    server = await startChatServer({ port: 0, host: '127.0.0.1', dataPath });
    const returning = client(server.port);
    const restored = await returning.next('init');
    assert.equal(restored.messages.length, 2);
    assert.equal(restored.messages[0].id, ack.message.id);
    assert.equal(restored.messages[1].id, reply.message.id);
  } finally {
    await server.close();
    await removeTestDirectory(directory);
  }
});

test('chat rejects caregiver, empty, excessive and malformed messages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metacare-chat-invalid-'));
  const server = await startChatServer({ port: 0, host: '127.0.0.1', dataPath: join(directory, 'chat.json') });
  try {
    const visitor = client(server.port);
    await visitor.next('init');
    for (const invalid of [
      { role: 'caregiver', text: '안녕하세요' },
      { role: 'patient', text: ' ' },
      { role: 'patient', text: '가'.repeat(1001) },
    ]) {
      visitor.socket.send(JSON.stringify({ type: 'send', clientId: 'invalid-message-001', ...invalid }));
      assert.equal((await visitor.next('error')).type, 'error');
    }
    const closed = new Promise<number>((resolve) => visitor.socket.once('close', resolve));
    visitor.socket.send('{invalid json');
    await visitor.next('error');
    assert.equal(await closed, 1007);
    const stillWorking = client(server.port);
    assert.deepEqual((await stillWorking.next('init')).messages, []);
  } finally {
    await server.close();
    await removeTestDirectory(directory);
  }
});

test('chat retains at most 200 messages and closes oversized frames safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metacare-chat-limits-'));
  const dataPath = join(directory, 'chat.json');
  const history: ChatMessage[] = Array.from({ length: 200 }, (_, index) => ({
    id: `server-id-${index}`, clientId: `seed-client-${index}`, role: 'patient',
    text: `예시 메시지 ${index}`, createdAt: new Date(2026, 9, 28, 8, 0, index).toISOString(),
  }));
  await writeFile(dataPath, JSON.stringify({ version: 1, messages: history }), 'utf8');
  const server = await startChatServer({ port: 0, host: '127.0.0.1', dataPath });
  try {
    const visitor = client(server.port);
    assert.equal((await visitor.next('init')).messages.length, 200);
    visitor.socket.send(JSON.stringify({ type: 'send', clientId: 'new-message-201', role: 'patient', text: '새 메시지' }));
    await visitor.next('ack');
    const persisted = JSON.parse(await readFile(dataPath, 'utf8')) as { messages: ChatMessage[] };
    assert.equal(persisted.messages.length, 200);
    assert.equal(persisted.messages[0].clientId, 'seed-client-1');
    assert.equal(persisted.messages.at(-1)?.clientId, 'new-message-201');
    const closed = new Promise<number>((resolveClose) => visitor.socket.once('close', resolveClose));
    visitor.socket.send('x'.repeat(9000));
    assert.equal(await closed, 1009);
    const stillWorking = client(server.port);
    assert.equal((await stillWorking.next('init')).messages.length, 200);
  } finally {
    await server.close();
    await removeTestDirectory(directory);
  }
});
