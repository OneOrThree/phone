import { useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { M, transition } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T } from '@/constants/theme';
import { GlassPillFill, isLiquidGlassSupported } from '@/components/liquidGlass';
import { PressableScale } from '@/components/PressableScale';
import type { V2RootStackParamList } from '@/navigation/types';

// 커스텀 탭바 — Claude Design "01 홈" 시안: 글래스 바 + 4탭 + 중앙 FAB(집중 시작).
// 바 배경은 SVG 패스 — 상단 가운데가 FAB 모양으로 오목하게 파인다(겹침 대신 안착).

const BAR_H = 56;

// GROMO-652: 홈 첫 진입 가이드가 중앙 FAB를 스포트라이트하기 위한 윈도 좌표.
// wrap(bottom:0, paddingTop=T.space.sm, paddingBottom=max(insets.bottom, T.space.sm))과
// fab(top: T.space.sm - FAB_LIFT - FAB_R, 중앙 정렬) 레이아웃을 그대로 수식화한 값 —
// 탭바 레이아웃을 바꾸면 이 함수도 함께 갱신할 것.
export function fabWindowRect(
  winW: number,
  winH: number,
  insetsBottom: number,
): { x: number; y: number; w: number; h: number } {
  const padBottom = Math.max(insetsBottom, T.space.sm);
  const wrapTop = winH - (T.space.sm + BAR_H + padBottom);
  return {
    x: winW / 2 - FAB_R,
    y: wrapTop + (T.space.sm - FAB_LIFT - FAB_R),
    w: FAB_R * 2,
    h: FAB_R * 2,
  };
}
const BAR_R = 28; // 바 모서리
const FAB_R = 28; // FAB 반지름(56/2)
const NOTCH_R = FAB_R + 5; // 파임 반지름 — FAB 둘레에 5px 숨통
const FAB_LIFT = -8; // FAB 중심의 바 상단선 대비 높이 — 양수=위로 뜸, 0=반 안착, 음수=더 깊이 안착
// 유리 느낌 — 기존 0.96이 탁해 보여 투명도를 크게 낮춤(파임 형태라 BlurView 마스킹 불가, 반투명으로 대체)
const BAR_FILL = 'rgba(252,250,246,0.55)';
const BAR_STROKE = 'rgba(255,255,255,0.75)';

// 리퀴드 글래스 하이라이트 — 선택 탭을 감싸는 유리 알약(타원)이 탭 전환마다 미끄러져 이동
// (iOS 26 리퀴드 글래스 탭 스위처 참고 — 굴절 필터는 RN에서 불가, 반투명 타원+오버슛으로 질감만)
const HIGHLIGHT_W = 60;
const HIGHLIGHT_H = 38;
// 슉 미끄러지고 살짝 넘쳤다 안착 — 값은 M.dur.base · M.curve.overshoot가 정본.
const highlightSlide = transition({
  property: 'transform',
  duration: M.dur.base,
  curve: 'overshoot',
});

// 상단 가운데가 파인 라운드 바 경로. 파임 호는 FAB 중심(cx, -FAB_LIFT)·반지름 NOTCH_R 원의
// 바 상단선(y=0) 아래 부분 — 교점 반너비 a = √(R²-lift²).
// index번째 탭의 중앙 x — 바 padding(8)·중앙 fabSlot(72)을 반영해 4탭 균등 분할과 일치시킨다
function tabCenterX(w: number, index: number): number {
  const tabW = (w - 16 - 72) / 4;
  return 8 + tabW * (index + 0.5) + (index >= 2 ? 72 : 0);
}

// FAB_LIFT가 음수(중심이 상단선 아래)면 아래쪽 호가 반원을 넘으므로 large-arc(1)로 그린다.
function barPath(w: number): string {
  const cx = w / 2;
  const a = Math.sqrt(NOTCH_R * NOTCH_R - FAB_LIFT * FAB_LIFT);
  const largeArc = FAB_LIFT < 0 ? 1 : 0;
  return [
    `M ${BAR_R} 0`,
    `H ${cx - a}`,
    `A ${NOTCH_R} ${NOTCH_R} 0 ${largeArc} 0 ${cx + a} 0`,
    `H ${w - BAR_R}`,
    `A ${BAR_R} ${BAR_R} 0 0 1 ${w} ${BAR_R}`,
    `V ${BAR_H - BAR_R}`,
    `A ${BAR_R} ${BAR_R} 0 0 1 ${w - BAR_R} ${BAR_H}`,
    `H ${BAR_R}`,
    `A ${BAR_R} ${BAR_R} 0 0 1 0 ${BAR_H - BAR_R}`,
    `V ${BAR_R}`,
    `A ${BAR_R} ${BAR_R} 0 0 1 ${BAR_R} 0`,
    'Z',
  ].join(' ');
}
type IconPair = [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap];
const ICONS: Record<string, IconPair> = {
  홈: ['home', 'home-outline'],
  리그: ['trophy', 'trophy-outline'],
  그룹: ['people', 'people-outline'],
  전체: ['menu', 'menu-outline'],
};

// 렌더 중에 정의하면 렌더마다 새 컴포넌트 타입이 되어 탭 서브트리가 리마운트됨 — TabBar 밖에 둔다
function Tab({
  index,
  state,
  navigation,
}: Pick<BottomTabBarProps, 'state' | 'navigation'> & { index: number }) {
  const route = state.routes[index];
  if (!route) return <View style={s.tab} />;
  const focused = state.index === index;
  const [on, off] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
  return (
    // 이미 선택된 탭은 아무 동작이 없으므로 피드백을 전부 끈다 — 스케일까지 끄지 않으면
    // "눌리긴 했는데 아무 일도 안 일어난다"가 되어 피드백 언어가 어긋난다.
    <PressableScale
      testID={`tabbar.tab.${route.name}`}
      style={s.tab}
      scaleTo={focused ? 1 : 0.9}
      haptic={focused ? false : 'select'}
      sound={!focused}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={route.name}
      onPress={() => {
        if (!focused) navigation.navigate(route.name);
      }}
    >
      <Ionicons name={focused ? on : off} size={26} color={focused ? T.accent : T.inkMuted} />
    </PressableScale>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const rootNav = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // '동작 줄이기'면 알약이 미끄러지지 않고 선택 탭으로 즉시 이동한다(transform은 그대로 적용).
  const m = useMotion();
  // 파임 경로는 실제 폭 기준으로 그린다 — onLayout 측정 전에는 배경 생략
  const [barW, setBarW] = useState(0);

  return (
    <View
      style={[s.wrap, { paddingBottom: Math.max(insets.bottom, T.space.sm) }]}
      pointerEvents="box-none"
    >
      <View style={s.bar} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
        {barW > 0 && (
          <Svg width={barW} height={BAR_H} style={StyleSheet.absoluteFill}>
            <Path d={barPath(barW)} fill={BAR_FILL} stroke={BAR_STROKE} strokeWidth={1} />
          </Svg>
        )}
        {barW > 0 && (
          // 선택 탭 중앙으로 미끄러지는 유리 원판 — 탭 아이콘 뒤(레이어 순서상 Tab보다 먼저).
          // iOS 26+는 네이티브 리퀴드 글래스(GROMO-848), 미지원은 기존 반투명 흰 알약
          <Animated.View
            style={[
              s.highlight,
              isLiquidGlassSupported && s.highlightGlassHost,
              { transform: [{ translateX: tabCenterX(barW, state.index) - HIGHLIGHT_W / 2 }] },
              m.css(highlightSlide),
            ]}
          >
            <GlassPillFill borderRadius={HIGHLIGHT_H / 2} tintColor="rgba(255,255,255,0.45)" />
          </Animated.View>
        )}
        <Tab index={0} state={state} navigation={navigation} />
        <Tab index={1} state={state} navigation={navigation} />
        <View style={s.fabSlot} />
        <Tab index={2} state={state} navigation={navigation} />
        <Tab index={3} state={state} navigation={navigation} />
      </View>

      {/* 중앙 FAB — 집중 시작 */}
      <PressableScale
        testID="tabbar.fab"
        style={s.fab}
        scaleTo={0.94}
        haptic="light"
        accessibilityLabel="집중 시작"
        onPress={() => rootNav.navigate('FocusCategory')}
      >
        <View style={s.fabInner}>
          {/* ▶ 재생(시작) 아이콘 — 삼각형이 왼쪽으로 치우쳐 보여서 살짝 오른쪽 보정 */}
          <Ionicons name="play" size={26} color={T.white} style={s.playIcon} />
        </View>
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: T.space.md,
    paddingTop: T.space.sm,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    height: BAR_H,
    // 배경·테두리는 SVG 패스(파임 포함)가 그린다 — 뷰 자체는 투명 유지
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.space.sm,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  // HIG 44pt+ 터치타겟 — 바 전체 높이(56)를 채워 아이콘만한 좁은 세로 탭이 안 되게(GROMO-846)
  tab: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
  fabSlot: { width: 72 },
  // 리퀴드 글래스 하이라이트 알약(타원) — 미지원 기기 폴백 질감 포함
  highlight: {
    position: 'absolute',
    top: (BAR_H - HIGHLIGHT_H) / 2,
    left: 0,
    width: HIGHLIGHT_W,
    height: HIGHLIGHT_H,
    borderRadius: HIGHLIGHT_H / 2,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  // 네이티브 유리를 쓸 땐 자체 배경·테두리를 끈다(채움은 GlassPillFill)
  highlightGlassHost: { backgroundColor: 'transparent', borderWidth: 0 },
  fab: {
    position: 'absolute',
    // FAB 중심이 바 상단선에서 FAB_LIFT만큼 위 — 파임 호와 동심으로 안착
    // (wrap paddingTop 8 기준: 8 - FAB_LIFT - FAB_R)
    top: 8 - FAB_LIFT - FAB_R,
    alignSelf: 'center',
    ...Platform.select({ ios: {}, android: {} }),
  },
  playIcon: { marginLeft: 3 },
  fabInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.accent,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});
