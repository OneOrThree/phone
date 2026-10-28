// 홈 왼쪽 아래 최근 채팅 줄(GROMO-2501) — 게임 채팅창처럼 최근 글이 「이름: 글」 한 줄씩 잠깐 떴다가 흐려진다.
// - 홈에 들어오면(이 부품이 마운트되면) 최근 글을 최대 3줄 띄우고, 그 뒤 도착한 글은 한 줄씩 더한다.
// - 줄마다 8초 뒤 흐려지며 사라진다. 동작 줄이기면 흐림 없이 바로 사라지고, 앱이 백그라운드인 동안은 시간이 멈춘다.
// - 아래 작은 말풍선 버튼은 늘 남는다. 줄이나 버튼을 누르면 채팅방을 연다.
// - 스크린리더는 말풍선 버튼 하나(「섬 채팅 열기」)만 읽는다 — 흐려지는 줄은 읽지 않는다.
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C, Txt } from '@/design-system/patterns';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';

const T = componentTokens.homeChatLog;

export type HomeChatLine = { id: string; name: string; text: string; at: number };
type Shown = HomeChatLine & { expiresAt: number };

export function HomeChatLog({
  lines,
  pending = false,
  onOpen,
}: {
  lines: HomeChatLine[];
  /** 채팅 목록을 다시 받는 중(차단 목록 재검증 등)이라 잠깐 비어 있을 뿐이면 true — 띄운 줄을 지우지 않는다. */
  pending?: boolean;
  onOpen: () => void;
}) {
  const reduceMotion = useContext(MotionContext);
  const [shown, setShown] = useState<Shown[]>([]);
  const [paused, setPaused] = useState(false);
  // 이미 띄웠거나 띄우지 않기로 한 글 — 새로 도착한 글만 한 줄씩 더한다
  const seen = useRef(new Set<string>());
  const newest = useRef(-Infinity);
  const pausedAt = useRef(0);

  useEffect(() => {
    // 다시 받는 중(pending)에 잠깐 빈 목록은 띄운 줄을 지우지 않는다(복귀 뒤 다시 채워진다).
    if (pending) return;
    const fresh = lines.filter((l) => !seen.current.has(l.id) && l.at >= newest.current);
    for (const l of lines) seen.current.add(l.id);
    // 차단·권한 상실로 lines 에서 빠진 글은 띄워 둔 줄에서도 바로 뺀다 — 남은 글이 없어 lines 가 비어도 뺀다.
    const present = new Set(lines.map((l) => l.id));
    if (!fresh.length) {
      setShown((prev) => prev.filter((l) => present.has(l.id)));
      return;
    }
    newest.current = Math.max(newest.current, ...fresh.map((l) => l.at));
    const expiresAt = Date.now() + T.lineMs;
    setShown((prev) =>
      [...prev.filter((l) => present.has(l.id)), ...fresh.map((l) => ({ ...l, expiresAt }))].slice(
        -T.maxLines,
      ),
    );
  }, [lines, pending]);

  // 앱이 뒤로 가 있는 동안은 8초가 흐르지 않는다 — 돌아오면 멈춘 만큼 뒤로 민다
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (!pausedAt.current) return;
        const delta = Date.now() - pausedAt.current;
        pausedAt.current = 0;
        setShown((prev) => prev.map((l) => ({ ...l, expiresAt: l.expiresAt + delta })));
        setPaused(false);
      } else if (!pausedAt.current) {
        pausedAt.current = Date.now();
        setPaused(true);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!shown.length || paused) return;
    const next = Math.min(...shown.map((l) => l.expiresAt));
    const timer = setTimeout(
      () => setShown((prev) => prev.filter((l) => l.expiresAt > Date.now())),
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [shown, paused]);

  return (
    <View pointerEvents="box-none" style={{ alignItems: 'flex-start', gap: T.gap }}>
      {shown.length > 0 && (
        <Pressable
          testID="home-chat-lines"
          onPress={onOpen}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ alignSelf: 'stretch', alignItems: 'flex-start', gap: T.gap }}
        >
          {shown.map((l) => (
            <Line key={l.id} line={l} paused={paused} reduceMotion={reduceMotion} />
          ))}
        </Pressable>
      )}
      <Pressable
        testID="home-chat-open"
        accessibilityRole="button"
        accessibilityLabel={t('islandChat.open')}
        onPress={onOpen}
        style={({ pressed }) => ({
          width: T.bubbleSize,
          height: T.bubbleSize,
          borderRadius: T.bubbleSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: semanticTokens.color.surface,
          borderWidth: semanticTokens.stroke.default,
          borderColor: semanticTokens.color.outline,
          boxShadow: `0px ${T.bubbleShadowOffset}px 0px ${semanticTokens.color.outline}`,
          transform: [{ scale: pressed && !reduceMotion ? 0.97 : 1 }],
        })}
      >
        <Svg width={T.iconSize} height={T.iconSize} viewBox="0 0 24 24">
          <Path
            d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z"
            stroke={C.ink}
            strokeWidth={2}
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

// 한 줄 — 사라질 시각 FADE 전에 흐려지기 시작한다. 동작 줄이기·멈춤 중에는 흐리지 않는다
function Line({
  line,
  paused,
  reduceMotion,
}: {
  line: Shown;
  paused: boolean;
  reduceMotion: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(1);
    if (reduceMotion || paused) return;
    const timer = setTimeout(
      () =>
        Animated.timing(opacity, {
          toValue: 0,
          duration: T.fadeMs,
          useNativeDriver: true,
        }).start(),
      Math.max(0, line.expiresAt - T.fadeMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [line.expiresAt, opacity, paused, reduceMotion]);
  return (
    <Animated.View
      style={{
        maxWidth: '100%',
        opacity,
        paddingVertical: T.paddingVertical,
        paddingHorizontal: T.paddingHorizontal,
        borderRadius: T.radius,
        borderWidth: 1,
        borderColor: T.border,
        backgroundColor: T.background,
      }}
    >
      <Txt numberOfLines={1} style={{ fontSize: T.textSize, lineHeight: T.lineHeight }}>
        <Txt style={{ fontSize: T.textSize, lineHeight: T.lineHeight, fontWeight: '700' }}>
          {line.name}:
        </Txt>{' '}
        {line.text}
      </Txt>
    </Animated.View>
  );
}
