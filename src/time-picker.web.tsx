import React, { useCallback, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type Ref } from 'react';
import { C } from './ui';
import { parseClockNumber, toClockTime, type TimePickerProps } from './clock-time';
import { TimeTrigger } from './time-trigger';

const ROW = 44;
const periods = ['오전', '오후'] as const;
const hours = Array.from({ length: 12 }, (_, index) => String(index + 1));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
type WheelHandle = { alignInitial: () => void; read: () => number };

function centeredIndex(top: number, length: number) {
  return Math.max(0, Math.min(length - 1, Math.round(top / ROW)));
}

function Wheel({ label, values, initial, first, unit = '', control, part, onInvalidChange }: {
  label: string; values: readonly string[]; initial: number; first: number; unit?: string; control: Ref<WheelHandle>;
  part?: 'hour' | 'minute'; onInvalidChange?: (invalid: boolean) => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const errorId = useId();
  const invalid = !!part && draft !== null && parseClockNumber(part, draft) === null;
  const explicit = useRef<number | null>(null);
  const [index, setIndex] = useState(initial);
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  useImperativeHandle(control, () => ({
    alignInitial: () => wheel.current?.scrollTo({ top: initial * ROW, behavior: 'instant' }),
    read: () => explicit.current ?? centeredIndex(wheel.current!.scrollTop, values.length),
  }), [initial, values.length]);

  const select = useCallback((element: HTMLDivElement, next: number) => {
    const bounded = Math.min(values.length - 1, Math.max(0, next));
    // A queued scroll-snap animation from a previous wheel gesture can arrive
    // after End, a row click, or a mouse drag. The explicit choice wins until
    // the user starts another scroll gesture.
    explicit.current = bounded;
    element.style.scrollSnapType = 'none';
    element.scrollTo({ top: bounded * ROW, behavior: 'instant' });
    setIndex(bounded);
  }, [values.length]);
  const editing = draft !== null;
  useLayoutEffect(() => {
    if (!editing) return;
    const field = input.current!;
    function resumeWheel(event: WheelEvent) {
      if (!event.deltaY || event.ctrlKey) return;
      event.preventDefault();
      const element = wheel.current!;
      const current = explicit.current ?? centeredIndex(element.scrollTop, values.length);
      const steps = event.deltaMode === 0 ? Math.round(event.deltaY / ROW) : Math.round(event.deltaY);
      setDraft(null);
      onInvalidChange?.(false);
      select(element, current + (steps || Math.sign(event.deltaY)));
      element.focus({ preventScroll: true });
    }
    field.addEventListener('wheel', resumeWheel, { passive: false });
    return () => field.removeEventListener('wheel', resumeWheel);
  }, [editing, onInvalidChange, select, values.length]);
  const edit = (text: string) => {
    if (!part) return;
    setDraft(text);
    const number = parseClockNumber(part, text);
    onInvalidChange?.(number === null);
    if (number !== null) select(wheel.current!, number - first);
  };
  const openInput = (index: number, digit?: string) => {
    // Reveal and focus the existing field during the tap itself so mobile
    // browsers open the keypad and select the current value for replacement.
    const field = input.current!;
    field.hidden = false;
    field.value = digit ?? values[index];
    edit(field.value);
    field.focus({ preventScroll: true });
    if (digit === undefined) field.select();
  };
  const finishInput = () => {
    if (invalid) return;
    setDraft(null);
  };
  const beginScroll = (element: HTMLDivElement) => {
    if (draft !== null) {
      setDraft(null);
      onInvalidChange?.(false);
    }
    explicit.current = null;
    element.style.scrollSnapType = 'y mandatory';
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.moved) {
      ignoreClick.current = true;
      const element = event.currentTarget;
      const next = centeredIndex(element.scrollTop, values.length);
      select(element, next);
    }
    drag.current = null;
  };
  return <div style={{ flex: 1, minWidth: 0 }}>
    <div aria-hidden="true" style={styles.caption}>{label}</div>
    <div style={{ position: 'relative' }}>
      <div aria-hidden="true" style={styles.band} />
      <div ref={wheel} role="spinbutton" tabIndex={draft === null ? 0 : -1} aria-label={label}
        aria-hidden={draft !== null || undefined} title={part ? '가운데 숫자를 눌러 직접 입력' : undefined}
        aria-valuemin={first} aria-valuemax={first + values.length - 1}
        aria-valuenow={first + index} aria-valuetext={values[index] + unit}
        className="metacare-time-wheel" style={styles.wheel}
        onWheelCapture={event => beginScroll(event.currentTarget)}
        onScroll={event => {
          const element = event.currentTarget;
          if (explicit.current === null) setIndex(centeredIndex(element.scrollTop, values.length));
          else if (Math.abs(element.scrollTop - explicit.current * ROW) > 0.5)
            element.scrollTo({ top: explicit.current * ROW, behavior: 'instant' });
        }}
        onKeyDown={event => {
          const current = explicit.current ?? centeredIndex(event.currentTarget.scrollTop, values.length);
          if (part && !event.ctrlKey && !event.metaKey && !event.altKey &&
              (event.key === 'Enter' || event.key === ' ' || /^\d$/.test(event.key))) {
            event.preventDefault();
            openInput(current, /^\d$/.test(event.key) ? event.key : undefined);
            return;
          }
          const next = { ArrowUp: current + 1, ArrowDown: current - 1, Home: 0, End: values.length - 1 }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          select(event.currentTarget, next);
        }}
        onClick={event => {
          if (ignoreClick.current) return;
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-index]');
          if (!row) return;
          const item = Number(row.dataset.wheelIndex);
          if (part && item === centeredIndex(event.currentTarget.scrollTop, values.length)) openInput(item);
          else select(event.currentTarget, item);
        }}
        onPointerDown={event => {
          ignoreClick.current = false;
          beginScroll(event.currentTarget);
          if (event.pointerType === 'mouse' && event.button === 0) {
            drag.current = { y: event.clientY, top: event.currentTarget.scrollTop, moved: false };
          }
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || event.pointerType !== 'mouse') return;
          if (event.buttons !== 1) { endDrag(event); return; }
          const distance = start.y - event.clientY;
          if (!start.moved && Math.abs(distance) < 4) return;
          if (!start.moved) {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.style.scrollSnapType = 'none';
            start.moved = true;
          }
          event.currentTarget.scrollTop = start.top + distance;
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div aria-hidden="true" style={{ height: ROW }} />
        {values.map((value, item) => <div key={value} aria-hidden="true" data-wheel-index={item}
          style={{ ...styles.row, fontWeight: item === index ? 700 : 400, color: item === index ? C.navy : C.muted,
            ...(part && item === index ? styles.editableValue : {}) }}>
          {value}
        </div>)}
        <div aria-hidden="true" style={{ height: ROW }} />
      </div>
      {part && <input ref={input} hidden={!editing} aria-label={`${label} 직접 입력`} type="text" inputMode="numeric"
        enterKeyHint="done" autoComplete="off" spellCheck={false} value={draft ?? ''} onChange={event => edit(event.target.value)}
        aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onBlur={finishInput}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!invalid) wheel.current?.focus({ preventScroll: true });
          }
        }}
        style={{ ...styles.input, borderColor: invalid ? '#b04444' : C.blue }} />}
    </div>
    {invalid && <div id={errorId} style={styles.error}>{part === 'hour' ? '1~12 입력' : '0~59 입력'}</div>}
  </div>;
}

function TimeDialog({ label, initialTime, onCancel, onConfirm }: {
  label: string; initialTime: string; onCancel: () => void; onConfirm: (time: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const period = useRef<WheelHandle>(null);
  const hour = useRef<WheelHandle>(null);
  const minute = useRef<WheelHandle>(null);
  const [invalidHour, setInvalidHour] = useState(false);
  const [invalidMinute, setInvalidMinute] = useState(false);
  const title = useId();
  const [hour24, minuteIndex] = initialTime.split(':').map(Number);
  const periodIndex = hour24 < 12 ? 0 : 1;
  const hourIndex = (hour24 % 12 || 12) - 1;
  useLayoutEffect(() => {
    const panel = dialog.current!;
    panel.showModal();
    period.current!.alignInitial();
    hour.current!.alignInitial();
    minute.current!.alignInitial();
    return () => panel.close();
  }, [periodIndex, hourIndex, minuteIndex]);
  function confirm() {
    if (invalidHour || invalidMinute) return;
    // Read the visible positions also when a wheel is still decelerating.
    const time = toClockTime(periods[period.current!.read()], hours[hour.current!.read()], minutes[minute.current!.read()]);
    if (time) onConfirm(time);
  }
  return <dialog ref={dialog} className="metacare-time-dialog" aria-modal="true" aria-labelledby={title} style={styles.dialog}
    onKeyDown={event => {
      // Close on keyup: RN Web also dismisses its parent modal on Escape keyup.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
    }}
    onKeyUp={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
    }}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <style>{`
      .metacare-time-dialog::backdrop { background: rgba(22, 36, 60, .42); }
      .metacare-time-wheel::-webkit-scrollbar { display: none; }
      .metacare-time-wheel:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 1px; }
    `}</style>
    <h2 id={title} style={styles.title}>{label}</h2>
    <div style={styles.columns}>
      <Wheel label="오전·오후" values={periods} initial={periodIndex} first={0} control={period} />
      <Wheel label="시" values={hours} initial={hourIndex} first={1} unit="시" control={hour}
        part="hour" onInvalidChange={setInvalidHour} />
      <Wheel label="분" values={minutes} initial={minuteIndex} first={0} unit="분" control={minute}
        part="minute" onInvalidChange={setInvalidMinute} />
    </div>
    <div style={styles.actions}>
      <button type="button" style={{ ...styles.button, backgroundColor: C.pale, color: C.navy }} onClick={onCancel}>취소</button>
      <button type="button" disabled={invalidHour || invalidMinute}
        style={{ ...styles.button, backgroundColor: invalidHour || invalidMinute ? C.muted : C.blue, color: C.white }}
        onClick={confirm}>선택 완료</button>
    </div>
  </dialog>;
}

export function TimePicker({ label, value, initialTime, onChange, disabled }: TimePickerProps) {
  const [editing, setEditing] = useState<string | null>(null);
  return <>
    <TimeTrigger label={label} value={value} disabled={disabled} onPress={() => setEditing(value ?? initialTime)} />
    {editing !== null && <TimeDialog label={label} initialTime={editing} onCancel={() => setEditing(null)}
      onConfirm={time => { setEditing(null); onChange(time); }} />}
  </>;
}

const styles = {
  dialog: { boxSizing: 'border-box', width: 'min(344px, calc(100% - 32px))', maxHeight: 'calc(100% - 32px)', margin: 'auto',
    backgroundColor: C.white, color: C.navy, padding: 20, border: 0, borderRadius: 16, fontFamily: 'system-ui, sans-serif' },
  title: { margin: '0 0 16px', fontSize: 20, lineHeight: '28px' },
  columns: { display: 'flex', gap: 8 },
  caption: { textAlign: 'center', marginBottom: 4, color: C.muted, fontSize: 13 },
  band: { position: 'absolute', top: ROW, height: ROW, left: 0, right: 0, background: C.pale, borderRadius: 8, pointerEvents: 'none' },
  wheel: { position: 'relative', height: ROW * 3, overflowY: 'auto', overscrollBehaviorY: 'contain', scrollSnapType: 'y mandatory',
    scrollbarWidth: 'none', touchAction: 'pan-y', userSelect: 'none', borderRadius: 8, cursor: 'pointer' },
  row: { height: ROW, display: 'flex', alignItems: 'center', justifyContent: 'center', scrollSnapAlign: 'center', fontSize: 20, fontVariantNumeric: 'tabular-nums' },
  editableValue: { cursor: 'text', textDecoration: 'underline dotted', textDecorationColor: C.muted, textUnderlineOffset: 4 },
  input: { position: 'absolute', top: ROW, left: 0, width: '100%', height: ROW, padding: 0, boxSizing: 'border-box',
    border: '2px solid', borderRadius: 8, outline: 'none', backgroundColor: C.white, color: C.navy,
    textAlign: 'center', fontFamily: 'inherit', fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  error: { marginTop: 4, textAlign: 'center', fontSize: 12, color: '#b04444' },
  actions: { display: 'flex', gap: 8, marginTop: 16 },
  button: { flex: 1, minHeight: 46, border: 0, borderRadius: 9, cursor: 'pointer', font: 'inherit', fontWeight: 650 },
} satisfies Record<string, CSSProperties>;
