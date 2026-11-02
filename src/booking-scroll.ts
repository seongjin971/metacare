import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef } from 'react';
import type { LayoutChangeEvent, ScrollView, ScrollViewProps } from 'react-native';

type AnchorSnapshot = { token: number; anchorY: number; scrollY: number };
type OffsetInput = {
  scrollY: number;
  previousAnchorY: number;
  nextAnchorY: number;
  contentHeight: number;
  viewportHeight: number;
};

/** Keep the booking form in place when the appointment list above it changes. */
export function preservedBookingOffset({ scrollY, previousAnchorY, nextAnchorY, contentHeight, viewportHeight }: OffsetInput): number | null {
  if (![scrollY, previousAnchorY, nextAnchorY, contentHeight, viewportHeight].every(Number.isFinite)
    || contentHeight <= 0 || viewportHeight <= 0 || scrollY < previousAnchorY) return null;
  const delta = nextAnchorY - previousAnchorY;
  if (Math.abs(delta) < 0.5) return null;
  return Math.max(0, Math.min(scrollY + delta, Math.max(0, contentHeight - viewportHeight)));
}

export function useBookingScrollAnchor() {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const metrics = useRef({ scrollY: 0, anchorY: null as number | null, viewportHeight: 0, contentHeight: 0 });
  const pending = useRef<AnchorSnapshot | null>(null);
  const sequence = useRef(0);
  const frame = useRef<number | null>(null);

  const discard = useCallback(() => {
    pending.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => discard, [discard]);

  const prepare = useCallback(() => {
    discard();
    const token = ++sequence.current;
    const { anchorY, scrollY } = metrics.current;
    // A cancellation while viewing the list should not pull the form into view.
    if (anchorY !== null && scrollY >= anchorY) pending.current = { token, anchorY, scrollY };
    return token;
  }, [discard]);

  const cancel = useCallback((token: number) => {
    if (pending.current?.token === token) discard();
  }, [discard]);

  const onAnchorLayout = useCallback((event: LayoutChangeEvent) => {
    metrics.current.anchorY = event.nativeEvent.layout.y;
    const snapshot = pending.current;
    if (!snapshot || Math.abs(metrics.current.anchorY - snapshot.anchorY) < 0.5 || frame.current !== null) return;

    // Content size is delivered in the same layout pass. Read its final value
    // on the next frame, once; never chase later layout or user scroll changes.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current?.token !== snapshot.token) return;
      pending.current = null;
      const current = metrics.current;
      const y = preservedBookingOffset({
        scrollY: snapshot.scrollY,
        previousAnchorY: snapshot.anchorY,
        nextAnchorY: current.anchorY ?? snapshot.anchorY,
        contentHeight: current.contentHeight,
        viewportHeight: current.viewportHeight,
      });
      if (y !== null && Math.abs(y - current.scrollY) >= 0.5) {
        current.scrollY = y;
        scrollRef.current?.scrollTo({ y, animated: false });
      }
    });
  }, []);

  const scrollViewProps = useMemo(() => ({
    onScroll: event => { metrics.current.scrollY = event.nativeEvent.contentOffset.y; },
    onScrollBeginDrag: discard,
    onLayout: event => { metrics.current.viewportHeight = event.nativeEvent.layout.height; },
    onContentSizeChange: (_width, height) => { metrics.current.contentHeight = height; },
    scrollEventThrottle: 16,
  } satisfies Pick<ScrollViewProps, 'onScroll' | 'onScrollBeginDrag' | 'onLayout' | 'onContentSizeChange' | 'scrollEventThrottle'>), [discard]);

  return { scrollRef, scrollViewProps, onAnchorLayout, prepare, cancel };
}

export type BookingScrollAnchor = ReturnType<typeof useBookingScrollAnchor>;
