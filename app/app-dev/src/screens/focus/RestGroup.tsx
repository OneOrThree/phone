import { Text } from '@/design-system/typography';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Color, State, currentIsland } from '@/services/model';
import { getSession } from '@/services/api/session';
import { catColor, type IslandPresence } from '@/screens/focus/useIslandPresence';
import { useAppLayout } from '@/utils/layout';
import {
  FiButton,
  FiModal,
  INK,
  ME,
  OUTLINE,
  a11yHidden,
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
type Rect = { l: number; t: number; r: number; b: number };
const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
// 한 자리가 차지하는 화면 상자: 식빵 그림(512 중 가로 48~464) + 머리 위 시간표(약 25px) + 발 아래 이름(약 22px), 글자 폭은 최소 76px
export const seatBox = (x: number, top: number, n: number): Rect => {
  const half = Math.max((n * 0.82) / 2, 38);
  return { l: x - half, r: x + half, t: top + (n * 126) / 512 - 27, b: top + (n * 464) / 512 + 25 };
};
export type Seat = { x: number; top: number; n: number; dx: number };
// 모닥불 자리 배치(화면 W×H, 안전 여백 inset). 배경은 화면을 덮도록(cover) 자른다: 세로는 모닥불을, 가로는 고양이 무리(시간표~이름표)를 가운데에.
// 6자리는 시안 그대로. 7명부터(정원 15명까지)는 바깥 줄: 화면 안·"휴식 중" 배지·아래 버튼·모닥불·안쪽 6자리와 겹치지 않는 곳을
// 모닥불에서 가까운 순서로 채운다. 다 못 들어가면 바깥 줄 고양이를 조금씩 작게(뒤로 물러앉은 느낌) 해서 다시 채운다.
export function restSeats(
  count: number,
  W: number,
  H: number,
  inset: { top: number; bottom: number; left: number; right: number },
) {
  const wideScreen = (1024 * H) / W <= 1024,
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
  const seats: Seat[] = SEATS.map(([dx, dy]) => ({
    dx,
    n: seatScale(dy) * s,
    top: (seatTop(dy) - y0) * s,
    x: (FIRE.x + dx * RX - x0) * s,
  }));
  const need = count - seats.length;
  if (need <= 0) return { x0, y0, s, seats };
  const wide = W >= 600,
    fx = (FIRE.x - x0) * s,
    fy = (FIRE.y - y0) * s,
    blocked: Rect[] = [
      ...seats.map((a) => seatBox(a.x, a.top, a.n)),
      // 모닥불 돌 테두리와 불꽃
      { l: (352 - x0) * s, t: (420 - y0) * s, r: (612 - x0) * s, b: (700 - y0) * s },
      // "휴식 중..." 배지·멈춘 집중 정보와 아래 버튼 줄
      wide ? { l: 0, t: 0, r: 220, b: 140 } : { l: 0, t: 0, r: 220, b: 200 },
      wide ? { l: W - 370, t: H - 80, r: W, b: H } : { l: 0, t: H - 96, r: W, b: H },
    ],
    bounds = { l: inset.left + 4, t: inset.top + 4, r: W - inset.right - 4, b: H - inset.bottom };
  let extra: Seat[] = [],
    last: Seat[] = [];
  for (const k of [0.85, 0.7, 0.55, 0.45]) {
    const n = BASE * s * k,
      probe = seatBox(0, 0, n),
      bw = probe.r - probe.l,
      bh = probe.b - probe.t,
      candidates: Seat[] = [];
    // 8px 간격으로 상자 왼쪽 위를 훑는다
    for (let l = bounds.l; l + bw <= bounds.r; l += 8)
      for (let tb = bounds.t; tb + bh <= bounds.b; tb += 8) {
        const x = l + bw / 2;
        candidates.push({ x, top: tb - probe.t, n, dx: x > fx ? 1 : -1 });
      }
    const d = (a: Seat) => Math.hypot((a.x - fx) / RX, (a.top + (n * 300) / 512 - fy) / RY);
    candidates.sort((a, b) => d(a) - d(b));
    last = candidates;
    extra = [];
    const taken = [...blocked];
    for (const c of candidates) {
      if (extra.length === need) break;
      const box = seatBox(c.x, c.top, c.n);
      if (taken.some((b) => overlaps(b, box))) continue;
      taken.push(box);
      extra.push(c);
    }
    if (extra.length === need) break;
  }
  // 가장 작게 해도 모자라는 아주 작은 화면(예: 320×568)에서는 남은 인원을 겹침을 허용해 격자 자리에 고루 앉힌다.
  // 격자 자리가 하나도 없으면 모닥불 앞에. 어떤 화면에서도 인원수만큼 자리를 돌려준다.
  const rest = need - extra.length,
    step = Math.max(1, Math.floor(last.length / rest)),
    n = BASE * s * 0.45;
  for (let m = 0; m < rest; m++)
    extra.push(last[(m * step) % last.length] ?? { x: fx, top: fy - n, n, dx: 1 });
  return { x0, y0, s, seats: [...seats, ...extra] };
}
export function RestGroup({
  state,
  live,
  resume,
  home,
  endRest,
  result = false,
  ...confirm
}: {
  state: State;
  // GROMO-2010 — 서버 모드에서 넘어오는 실시간 휴식 멤버. 없으면 기존 로컬 멤버 경로.
  live?: IslandPresence | null;
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
  const pausedSession = result ? null : state.session;
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
  // 서버 모드는 실시간 rest 멤버가 정본 — 휴식 시작 시각은 서버 시계를 단말 시계로 환산한다.
  const others =
    live?.status === 'ready'
      ? live.rest
          .filter((m) => m.userId !== getSession()?.userId)
          .map((m) => ({
            name: m.name ?? '주민',
            color: catColor(m.catColor),
            restStartedAt: m.restStartedAt
              ? Date.parse(m.restStartedAt) - live.clockOffset
              : Date.now(),
            restSeat: m.restSeat,
          }))
      : currentIsland(state).members.filter((m) => !m.focusing && m.restStartedAt);
  // 자리 배정: 나는 뒤 가운데(1번), 주민은 서버 restSeat(있고 겹치지 않으면) 아니면 0·2·3·4·5번, 7명부터는 바깥 줄(6번~)
  const taken = new Set<number>([1]);
  const actors = [
    { seat: 1, me: true, name: '나', color: state.color, restStartedAt: started },
    ...others.map((m, n) => {
      let seat = (m as { restSeat?: number | null }).restSeat;
      if (typeof seat !== 'number' || seat < 0 || seat === 1 || taken.has(seat))
        seat = n < 5 ? [0, 2, 3, 4, 5][n] : n + 1;
      while (taken.has(seat)) seat += 1;
      taken.add(seat);
      return { ...m, me: false, seat };
    }),
  ].sort((a, b) => a.seat - b.seat);
  const { width: W, height: H } = layout,
    { top: it, bottom: ib, left: il, right: ir } = layout.insets;
  // 자리 계산은 인원·화면 크기가 바뀔 때만(1초마다 도는 휴식 시간 갱신과 무관)
  const { x0, y0, s, seats } = useMemo(
    () => restSeats(actors.length, W, H, { top: it, bottom: ib, left: il, right: ir }),
    [actors.length, W, H, it, ib, il, ir],
  );
  // 자리가 없는 인원은 건너뛴다(restSeats 는 인원수만큼 돌려주지만 렌더링이 죽지 않게 한 번 더 막는다)
  const placed = actors.flatMap((a) => {
    const seat = seats[a.seat];
    if (!seat) return [];
    const { dx, n, top, x } = seat;
    return {
      ...a,
      dx,
      n,
      top,
      x,
      // 축소한 그림은 가장자리가 1~3px 번져 보이므로 시안(PIL 합성 bbox)과 같게 머리는 2px 위, 발은 3px 아래로
      head: top + (n * loafTop[a.color]) / 512 - 2,
      foot: top + (n * 464) / 512 + 3,
    };
  });
  return (
    <View testID="rest-group" style={{ flex: 1, overflow: clip }}>
      {/* 확인창·결과창이 떠 있으면 뒤 장면은 스크린리더에서 숨긴다 */}
      <View
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
        {...a11yHidden(confirming || result)}
      >
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
            alignItems: 'flex-start',
            gap: wide ? 8 : 10,
          }}
        >
          <View
            style={{
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
          {pausedSession && (
            <View
              testID="paused-focus-info"
              style={{
                maxWidth: W - Math.max(wide ? 30 : 18, safe.left + 12) - safe.right - 12,
                alignItems: 'flex-start',
                overflow: 'hidden',
                backgroundColor: '#FFFDFAB8',
                borderRadius: 14,
                paddingVertical: 6,
                paddingLeft: 12,
                paddingRight: 14,
              }}
            >
              <Text
                testID="paused-focus-subject"
                numberOfLines={1}
                style={{
                  maxWidth: '100%',
                  color: INK,
                  fontSize: 16,
                  lineHeight: 25.6,
                  fontWeight: '900',
                  letterSpacing: -0.5,
                  textShadowColor: '#FFFDFA',
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 8,
                }}
              >
                {pausedSession.subject}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel="멈춤">
                  {[0, 1].map((bar) => (
                    <View
                      key={bar}
                      style={{
                        width: 5,
                        height: 20,
                        borderRadius: 2,
                        backgroundColor: INK,
                        boxShadow: '0px 0px 8px #FFFDFA',
                      }}
                    />
                  ))}
                </View>
                <Text
                  testID="paused-focus-time"
                  style={{
                    color: INK,
                    fontSize: 32,
                    lineHeight: 36.8,
                    fontWeight: '900',
                    letterSpacing: -1.5,
                    fontVariant: ['tabular-nums'],
                    textShadowColor: '#FFFDFA',
                    textShadowOffset: { width: 0, height: 0 },
                    textShadowRadius: 8,
                  }}
                >
                  {hms(pausedSession.seconds)}
                </Text>
              </View>
            </View>
          )}
        </View>
        {/* 확인창이 떠 있는 동안에는 아래 버튼을 숨긴다 */}
      </View>
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
