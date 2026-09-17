import { Text } from '@/design-system/typography';
import React, { useState, useEffect, useRef } from 'react';
import { View, Image } from 'react-native';
import { Color, State, currentIsland } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import {
  FiButton,
  FiModal,
  INK,
  ME,
  OUTLINE,
  clip,
  fiTitle,
  hms,
} from '@/screens/focus/FishingIsland';
import { C } from '@/design-system/primitives';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// v2 시안 모닥불 전용 화면(GROMO-1862): 섬 지도가 아닌 모닥불 배경에 의자 없이 식빵 굽는 고양이만 앉힌다.
// 배경 원본 1024×1024에서 돌 테두리 중심은 (482,600), 자리는 그 바깥 타원(가로 168·세로 125).
const FIRE = { x: 482, y: 600 },
  RX = 168,
  RY = 125,
  BASE = 130;
// [가로 비율, 세로 비율] · 뒤쪽 3자리부터. 자리는 자동 배정: 나는 뒤 가운데(1번), 주민은 나머지를 순서대로.
const SEATS = [
  [-1, -0.72],
  [0, -1.32],
  [1, -0.72],
  [-1.15, 0.72],
  [0, 1.5],
  [1.15, 0.72],
];
const loaf: Record<Color, any> = {
  black: require('@/assets/characters/cat/black/loaf/loaf.png'),
  gray: require('@/assets/characters/cat/gray/loaf/loaf.png'),
  calico: require('@/assets/characters/cat/calico/loaf/loaf.png'),
  ginger: require('@/assets/characters/cat/ginger/loaf/loaf.png'),
  white: require('@/assets/characters/cat/white/loaf/loaf.png'),
  cream: require('@/assets/characters/cat/cream/loaf/loaf.png'),
};
// 식빵 그림(512)에서 실제로 그려진 윗줄 — 휴식 시간표를 머리 바로 위에 붙이는 기준(발은 464)
const loafTop: Record<Color, number> = {
  black: 126,
  gray: 126,
  calico: 120,
  ginger: 127,
  white: 124,
  cream: 126,
};
const seatScale = (dy: number) => BASE * (1 + 0.14 * dy); // 앞자리는 조금 크게
const seatTop = (dy: number) => FIRE.y + dy * RY - (seatScale(dy) * 464) / 512;
export function RestGroup({
  state,
  resume,
  home,
  endRest,
  result = false,
  ...confirm
}: {
  state: State;
  resume: () => void;
  home: () => void;
  endRest?: () => void;
  // 휴식 종료 결과창 뒤 배경으로 쓸 때는 버튼을 숨기고 휴식 시간을 종료 순간에 멈춘다
  result?: boolean;
  // 휴식 종료 확인창 열림 상태를 밖(뒤로가기 처리)에서 쥘 때
  confirming?: boolean;
  setConfirming?: (open: boolean) => void;
}) {
  const layout = useAppLayout(),
    wide = layout.width >= 600,
    safe = useSafeAreaInsets();
  const ended = result ? state.lastResult : null;
  const [own, setOwn] = useState(false),
    confirming = confirm.confirming ?? own,
    setConfirming = confirm.setConfirming ?? setOwn;
  const [now, setNow] = useState(ended?.at ?? Date.now());
  // 내 휴식 시작: 휴식 중이면 세션, 결과창이면 마지막 집중 구간이 끝난 때
  const started = useRef(
    state.session?.restStartedAt || ended?.intervals?.at(-1)?.end || Date.now(),
  ).current;
  useEffect(() => {
    if (result) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [result]);
  const others = currentIsland(state).members.filter((m) => !m.focusing && m.restStartedAt);
  // ponytail: 모닥불 자리는 6곳뿐이라 나 + 쉬는 주민 5명까지만 보인다. 더 늘면 자리 넘김이 필요하다.
  const actors = [
    { seat: 1, me: true, name: '나', color: state.color, restStartedAt: started },
    ...others.slice(0, 5).map((m, n) => ({ ...m, me: false, seat: [0, 2, 3, 4, 5][n] })),
  ].sort((a, b) => a.seat - b.seat);
  // 배경은 화면을 덮도록(cover) 자른다. 세로는 모닥불을, 가로는 고양이 무리(시간표~이름표)를 가운데에
  const W = layout.width,
    H = layout.height,
    wideScreen = (1024 * H) / W <= 1024,
    cw = wideScreen ? 1024 : (1024 * W) / H,
    ch = wideScreen ? (1024 * H) / W : 1024,
    spans = SEATS.flatMap(([, dy]) => [
      seatTop(dy) + (seatScale(dy) * 126) / 512 - 28,
      seatTop(dy) + (seatScale(dy) * 464) / 512 + 28,
    ]),
    x0 = wideScreen ? 0 : Math.max(0, Math.min(1024 - cw, FIRE.x - cw / 2)),
    y0 = wideScreen
      ? Math.max(0, Math.min(1024 - ch, (Math.min(...spans) + Math.max(...spans) - ch) / 2))
      : 0,
    s = W / cw;
  const placed = actors.map((a) => {
    const [dx, dy] = SEATS[a.seat],
      n = seatScale(dy) * s,
      top = (seatTop(dy) - y0) * s;
    return {
      ...a,
      dx,
      n,
      top,
      x: (FIRE.x + dx * RX - x0) * s,
      // 축소한 그림은 가장자리가 1~3px 번져 보이므로 시안(PIL 합성 bbox)과 같게 머리는 2px 위, 발은 3px 아래로
      head: top + (n * loafTop[a.color]) / 512 - 2,
      foot: top + (n * 464) / 512 + 3,
    };
  });
  return (
    <View testID="rest-group" style={{ flex: 1, overflow: clip }}>
      <Image
        source={require('@/assets/backgrounds/campfire/day.jpg')}
        style={{
          position: 'absolute',
          left: -x0 * s,
          top: -y0 * s,
          width: 1024 * s,
          height: 1024 * s,
        }}
      />
      {placed.map((a) => (
        <Image
          key={a.seat}
          testID={`loaf-${a.seat}`}
          source={loaf[a.color]}
          style={{
            position: 'absolute',
            left: a.x - a.n / 2,
            top: a.top,
            width: a.n,
            height: a.n,
            // 오른쪽 자리는 불을 보게 좌우 반전
            transform: [{ scaleX: a.dx > 0 ? -1 : 1 }],
          }}
        />
      ))}
      {placed.map((a) => (
        <React.Fragment key={a.seat}>
          {/* 휴식 시간은 머리 위(반투명 배경), 이름은 발 아래(그림자 글자) */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: a.x - 100, top: a.head - 3 - 21.6, width: 200 }}
          >
            <Text
              style={{
                alignSelf: 'center',
                backgroundColor: '#FFFDFAB8',
                borderRadius: 10,
                overflow: 'hidden',
                paddingVertical: 2,
                paddingHorizontal: 9,
                fontSize: 11,
                lineHeight: 17.6,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
                color: INK,
              }}
            >
              {hms(Math.max(0, (now - (a.restStartedAt || started)) / 1000))}
            </Text>
          </View>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: a.x - 100, top: a.foot + 2, width: 200 }}
          >
            <Text
              style={{
                textAlign: 'center',
                fontSize: 12,
                lineHeight: 19.2,
                fontWeight: '900',
                color: a.me ? ME : INK,
                textShadowColor: '#FFFDFA',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 5,
              }}
            >
              {a.name}
            </Text>
          </View>
        </React.Fragment>
      ))}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: wide ? Math.max(18, safe.top + 18) : Math.max(56, safe.top + 4),
          left: Math.max(wide ? 30 : 18, safe.left + 12),
          backgroundColor: C.sky,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 18,
          boxShadow: `0px 3px 0px ${OUTLINE}`,
          paddingVertical: wide ? 7 : 10,
          paddingHorizontal: wide ? 12 : 14,
        }}
      >
        <Text style={[fiTitle(wide ? 17 : 19), { lineHeight: (wide ? 17 : 19) * 1.3 }]}>
          휴식 중...
        </Text>
      </View>
      {/* 확인창이 떠 있는 동안에는 아래 버튼을 숨긴다 */}
      {!result && !confirming && (
        <View
          style={{
            position: 'absolute',
            bottom: wide ? Math.max(18, safe.bottom) : Math.max(36, safe.bottom + 4),
            ...(wide
              ? { right: Math.max(24, safe.right), width: 340 }
              : { left: Math.max(18, safe.left), right: Math.max(18, safe.right) }),
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <FiButton
            primary
            style={{ flex: 1 }}
            id="resume-focus"
            title={state.session ? '집중 이어가기' : '섬으로 돌아가기'}
            onPress={state.session ? resume : home}
          />
          {state.session && (
            <FiButton
              style={{ flex: 1 }}
              id="end-rest"
              title="휴식 종료하기"
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      )}
      {/* 휴식 종료는 집중이 통째로 끝나므로 한 번 묻는다. 계속 쉬기는 창만 닫고 휴식 시간은 계속 흐른다 */}
      {confirming && !result && (
        <FiModal>
          <Text style={fiTitle(wide ? 19 : 22)}>휴식을 끝내고 이번 집중을 마칠까요?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: wide ? 12 : 18 }}>
            <FiButton title="계속 쉬기" style={{ flex: 1 }} onPress={() => setConfirming(false)} />
            <FiButton
              primary
              id="confirm-end-rest"
              title="집중 종료"
              style={{ flex: 1 }}
              onPress={() => {
                setConfirming(false);
                (endRest || home)();
              }}
            />
          </View>
        </FiModal>
      )}
    </View>
  );
}
