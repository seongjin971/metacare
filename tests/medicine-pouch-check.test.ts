import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMedicinePouch, type PhotoAnalysis } from '../src/medicine-pouch-check.ts';

function analysis(text = '메타약국\n1일 3회 1회 1정\n식후 30분에 복용'): PhotoAnalysis {
  return { text, width: 1280, height: 960, meanLuminance: 150, darkPixelRatio: 0.12, blurScore: 120 };
}

function reason(value: unknown) {
  const result = checkMedicinePouch(value);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected ineligible photograph');
  assert.ok(result.message.length > 0);
  return result.reason;
}

test('clear Korean pouch instructions require dispensing or unit-dose context', () => {
  for (const text of [
    '메타약국\n1일 3회 1회 1정\n식후 30분에 복용',
    '조제일자 2026.10.29\n1회 2캡슐\n하루 2회',
    '아침약\n식후 30분에 복용하세요',
    '저녁약\n1회 1포 복용',
  ]) {
    assert.deepEqual(checkMedicinePouch(analysis(text)), { ok: true, method: 'medicine-pouch-text-v1' });
  }
});

test('OCR spacing and full-width digits do not discard independent evidence', () => {
  const text = '메 타 약 국\n１ 일 ３ 회\n１ 회 １ 정\n식 후 ３０ 분 복 용';
  assert.equal(checkMedicinePouch(analysis(text)).ok, true);
});

test('transparent unit-dose meal pouches do not require a pharmacy name', () => {
  for (const text of [
    '2026.10.29 아침 식후30분',
    '점심\n식후 30분',
    '저 녁\n식 전 ３０ 분',
    '아침약 식후',
    '저녁약 취침전',
    '메타약국\n점심\n식후',
    '조제일 2026.10.29\n아침\n식전',
  ]) {
    assert.equal(checkMedicinePouch(analysis(text)).ok, true, text);
  }
});

test('a meal name and broad timing alone do not authenticate a planner or meal note', () => {
  for (const text of ['아침 식후', '2026.10.29 점심 식전', '아침 산책 식후 커피', '저녁 식후 운동']) {
    assert.equal(reason(analysis(text)), 'uncertain', text);
  }
  assert.equal(reason(analysis('복약 안내문\n아침 식후30분')), 'not_pouch');
  assert.equal(reason({ ...analysis('아침 식후30분'), meanLuminance: 2, darkPixelRatio: 0.99 }), 'too_dark');
  assert.equal(reason({ ...analysis('점심 식후30분'), blurScore: 10 }), 'too_blurry');
});

test('black emulator frame is rejected even if its timestamp or injected text is legible', () => {
  assert.equal(reason({ ...analysis('29.10.26 04:02:01'), meanLuminance: 2, darkPixelRatio: 0.99 }), 'too_dark');
  assert.equal(reason({ ...analysis(), meanLuminance: 20, darkPixelRatio: 0.3 }), 'too_dark');
  assert.equal(reason({ ...analysis(), meanLuminance: 70, darkPixelRatio: 0.95 }), 'too_dark');
});

test('blurry or low resolution captures cannot pass on OCR text alone', () => {
  assert.equal(reason({ ...analysis(), blurScore: 10 }), 'too_blurry');
  assert.equal(reason({ ...analysis(), width: 240 }), 'uncertain');
});

test('receipts and prescriptions are not accepted despite pharmacy and dosing words', () => {
  for (const document of ['처방전', '약제비 영수증', '약제비 계산서', '복약 안내문', '복약안내서', '조제내역서']) {
    assert.equal(reason(analysis(`${document}\n메타약국\n1일 3회 식후 30분 복용`)), 'not_pouch');
  }
});

test('unrelated objects, timestamps and ordinary promises are not pouch evidence', () => {
  for (const text of ['29.10.26 04:02:01', '커피 4500원 따뜻한 음료', '부엌 식탁 사진']) {
    assert.equal(reason(analysis(text)), 'not_pouch');
  }
  assert.notEqual(checkMedicinePouch(analysis('아침 약속 식후 30분')).ok, true);
});

test('single words and incomplete labels remain uncertain', () => {
  for (const text of ['약', '약국', '아침약', '식후', '1일 3회', '약국 아침 점심 저녁', '복용방법 식후']) {
    assert.equal(checkMedicinePouch(analysis(text)).ok, false, text);
  }
  assert.equal(reason(analysis('')), 'uncertain');
  assert.equal(reason(analysis('   \n\t')), 'uncertain');
});

test('malformed and non-finite measurements fail closed without throwing', () => {
  for (const invalid of [
    undefined, null, [], {}, 'photo',
    { ...analysis(), text: null }, { ...analysis(), text: 'a'.repeat(20001) },
    { ...analysis(), width: 0 }, { ...analysis(), width: 12.5 }, { ...analysis(), height: 20001 },
    { ...analysis(), meanLuminance: NaN }, { ...analysis(), meanLuminance: 256 },
    { ...analysis(), darkPixelRatio: -0.1 }, { ...analysis(), darkPixelRatio: Infinity },
    { ...analysis(), blurScore: -1 }, { ...analysis(), blurScore: NaN },
  ]) {
    assert.equal(reason(invalid), 'invalid');
  }
});

test('accepted result contains no OCR text or identifying metadata', () => {
  const source = analysis('메타약국 홍길동 010-0000-0000\n1일3회 식후30분 복용');
  const before = JSON.stringify(source);
  const result = checkMedicinePouch(source);
  assert.deepEqual(result, { ok: true, method: 'medicine-pouch-text-v1' });
  assert.equal(JSON.stringify(source), before);
  assert.doesNotMatch(JSON.stringify(result), /홍길동|010|메타약국/);
});
