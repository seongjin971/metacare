import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewProps,
} from 'react-native';

const ReducedMotionContext = createContext(true);
const useNativeDriver = Platform.OS !== 'web';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  // Keep motion off until the system preference is known.
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      preferenceChanged = true;
      if (mounted) setReducedMotion(enabled);
    });

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted && !preferenceChanged) setReducedMotion(enabled);
    }).catch(() => {
      // A missing preference should never force animation on.
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  return (
    <ReducedMotionContext.Provider value={reducedMotion}>
      {children}
    </ReducedMotionContext.Provider>
  );
}

export function useReducedMotion() {
  return useContext(ReducedMotionContext);
}

// React Native Web does not export React Native's useAnimatedValue hook.
export function useMotionValue(initialValue: number) {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}

export const MotionPressable = forwardRef<React.ComponentRef<typeof Pressable>, PressableProps>(
  function MotionPressable({ children, style, disabled, onPressIn, onPressOut, ...props }, ref) {
    const reducedMotion = useReducedMotion();
    const progress = useMotionValue(0);
    const animation = useRef<Animated.CompositeAnimation | null>(null);
    const [pressed, setPressed] = useState(false);
    if (disabled && pressed) setPressed(false);
    const state = { pressed: !disabled && (pressed || !!props.testOnly_pressed) };
    const resolvedStyle = typeof style === 'function' ? style(state) : style;
    const flatStyle = StyleSheet.flatten(resolvedStyle);
    const baseOpacity = Number(flatStyle?.opacity ?? 1);
    const baseTransform = flatStyle?.transform;
    const scale = useMemo(() => progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.98],
    }), [progress]);
    const opacity = useMemo(() => Animated.multiply(baseOpacity, progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.9],
    })), [baseOpacity, progress]);

    useEffect(() => {
      animation.current?.stop();
      progress.setValue(0);
      return () => animation.current?.stop();
    }, [disabled, progress, reducedMotion]);

    const animatePress = useCallback((isPressed: boolean) => {
      animation.current?.stop();
      if (disabled || reducedMotion) {
        progress.setValue(0);
        return;
      }
      animation.current = Animated.timing(progress, {
        toValue: isPressed ? 1 : 0,
        duration: isPressed ? 80 : 130,
        easing: Easing.out(Easing.quad),
        useNativeDriver,
        isInteraction: false,
      });
      animation.current.start();
    }, [disabled, progress, reducedMotion]);

    return (
      <AnimatedPressable
        {...props}
        ref={ref}
        disabled={disabled}
        onPressIn={(event) => {
          setPressed(true);
          animatePress(true);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          setPressed(false);
          animatePress(false);
          onPressOut?.(event);
        }}
        style={[
          resolvedStyle,
          {
            opacity: reducedMotion ? baseOpacity * (state.pressed ? 0.9 : 1) : opacity,
            // Preserve caller transforms; string transforms still get opacity feedback.
            ...(!reducedMotion && typeof baseTransform !== 'string' ? {
              transform: [...(baseTransform ?? []), { scale }],
            } : {}),
          },
        ]}
      >
        {typeof children === 'function' ? children(state) : children}
      </AnimatedPressable>
    );
  },
);

type FadeInProps = ViewProps & {
  duration?: number;
  motionKey?: string | number;
};

export function FadeIn({ children, style, duration = 160, motionKey, ...props }: FadeInProps) {
  const reducedMotion = useReducedMotion();
  const progress = useMotionValue(reducedMotion ? 1 : 0);
  const previousKey = useRef(motionKey);
  const firstEffect = useRef(true);
  const flatStyle = StyleSheet.flatten(style);
  const baseOpacity = Number(flatStyle?.opacity ?? 1);
  const baseTransform = flatStyle?.transform;
  const opacity = useMemo(() => Animated.multiply(progress, baseOpacity), [baseOpacity, progress]);
  const translateY = useMemo(() => progress.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 0],
  }), [progress]);

  useEffect(() => {
    const shouldEnter = firstEffect.current || !Object.is(previousKey.current, motionKey);
    firstEffect.current = false;
    previousKey.current = motionKey;
    if (reducedMotion || !shouldEnter || duration <= 0) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [duration, motionKey, progress, reducedMotion]);

  return (
    <Animated.View
      {...props}
      style={[
        style,
        {
          opacity,
          ...(!reducedMotion && typeof baseTransform !== 'string' ? {
            transform: [...(baseTransform ?? []), { translateY }],
          } : {}),
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
