import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, StyleSheet, View } from 'react-native';
import { cat } from '@/constants/assets';
import { componentTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { sessionGeneration } from '@/services/api/session';
import type { State } from '@/services/model';
import { useAppLayout } from '@/utils/layout';

const c = componentTokens.departureStory;
const background = require('@/assets/ota/departure/storyboard.png');
const poses = ['tilt/tilt-frame-2', 'idle', 'side'] as const;

/** 공통 배경 세 컷에 내 고양이를 합성한다. 출항은 세션 시작·종료와 별개다. */
export function DepartureStory({
  state,
  destination,
  onComplete,
}: {
  state: State;
  destination: string;
  onComplete: () => void;
}) {
  const layout = useAppLayout();
  const [bounds, setBounds] = useState({ width: layout.width, height: layout.height });
  const [appState, setAppState] = useState(AppState.currentState);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(new Set<string>());
  const progress = useRef(new Animated.Value(0)).current;
  const elapsed = useRef(0);
  const completed = useRef(false);
  const mounted = useRef(true);
  const ownerGeneration = useRef(sessionGeneration()).current;
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const paused = appState === 'background' || appState === 'inactive';
  const finish = useCallback(() => {
    if (!mounted.current || completed.current || sessionGeneration() !== ownerGeneration) return;
    completed.current = true;
    callback.current();
  }, [ownerGeneration]);
  const markLoaded = useCallback((key: string) => {
    loaded.current.add(key);
    if (loaded.current.size === poses.length + 1) setReady(true);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', setAppState);
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    // 이미지 실패도 앱이 다시 활성화된 뒤에만 목적지로 이어 준다.
    if (failed && !paused) finish();
  }, [failed, paused, finish]);
  useEffect(() => {
    if (!ready || paused || completed.current) return;
    const done = elapsed.current;
    const began = Date.now();
    let cancelled = false;
    progress.setValue(done);
    const animation = Animated.timing(progress, {
      toValue: c.durationMs,
      duration: Math.max(0, c.durationMs - done),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !cancelled) finish();
    });
    return () => {
      cancelled = true;
      animation.stop();
      elapsed.current = Math.min(c.durationMs, done + Date.now() - began);
    };
  }, [ready, paused, progress, finish]);

  const panelWidth = c.imageWidth / poses.length;
  // 세로는 화면을 채우고 가로는 그림 전체를 가운데 둔다. 고양이 발과 소품은 같은 좌표계를 쓴다.
  const scale = Math.min(bounds.width / panelWidth, bounds.height / c.imageHeight);
  const width = panelWidth * scale;
  const height = c.imageHeight * scale;
  const fade = state.settings.reduceMotion ? 1 : c.fadeMs;
  const opacity = (index: number) => {
    const start = index === 1 ? c.secondAtMs : c.thirdAtMs;
    if (index === 0)
      return progress.interpolate({
        inputRange: [0, c.secondAtMs, c.secondAtMs + fade, c.durationMs],
        outputRange: [1, 1, 0, 0],
      });
    if (index === 1)
      return progress.interpolate({
        inputRange: [0, start, start + fade, c.thirdAtMs, c.thirdAtMs + fade, c.durationMs],
        outputRange: [0, 0, 1, 1, 0, 0],
      });
    return progress.interpolate({
      inputRange: [0, start, start + fade, c.durationMs],
      outputRange: [0, 0, 1, 1],
    });
  };

  return (
    <View
      testID="departure-story"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('departureStory.label', { destination })}
      accessibilityLiveRegion="polite"
      style={styles.root}
      onLayout={({ nativeEvent: { layout: next } }) =>
        setBounds({ width: next.width, height: next.height })
      }
    >
      <View
        testID="departure-scene"
        style={{ width, height, overflow: 'hidden' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        pointerEvents="none"
      >
        {c.shots.map((shot, index) => {
          const size = width * shot.catWidth;
          const start = index === 1 ? c.secondAtMs : 0;
          const end = index === 1 ? c.thirdAtMs : c.secondAtMs;
          const rotate = progress.interpolate({
            inputRange: [start, (start + end) / 2, end],
            outputRange: ['0deg', `${c.leanDegrees}deg`, '0deg'],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={index}
              style={[StyleSheet.absoluteFill, { opacity: opacity(index) }]}
            >
              <Image
                testID={`departure-background-${index}`}
                source={background}
                style={{
                  position: 'absolute',
                  width: width * poses.length,
                  height,
                  left: -index * width,
                }}
                resizeMode="cover"
                onLoad={() => markLoaded('background')}
                onError={() => setFailed(true)}
              />
              <Animated.Image
                testID={`departure-cat-${index}`}
                source={cat(state.color, poses[index])}
                resizeMode="contain"
                onLoad={() => markLoaded(`cat-${index}`)}
                onError={() => setFailed(true)}
                style={{
                  position: 'absolute',
                  width: size,
                  height: size,
                  left: width * shot.catX - size * c.footX,
                  top: height * shot.catY - size * c.footY,
                  transformOrigin: [size * c.footX, size * c.footY, 0],
                  transform: [
                    { scaleX: shot.flip },
                    { rotate: state.settings.reduceMotion || index === 2 ? '0deg' : rotate },
                  ],
                }}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
});
