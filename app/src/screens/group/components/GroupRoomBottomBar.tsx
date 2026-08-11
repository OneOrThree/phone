import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import { PressableScale } from '@/components/PressableScale';
import type { V2RootStackParamList } from '@/navigation/types';
import { discardInitialGroupRoomReturn } from '@/navigation/groupEntrySource';

// 그룹방 전용 하단바(F2 Part2) — 앱 커스텀 TabBar와 같은 모양(글래스 노치 바 + 4탭 + 중앙 ▶ FAB).
// 그룹방은 탭 네비 밖(스택 화면)이라 실제 TabBar(BottomTabBarProps 결합)를 못 붙여 비주얼만 복제한다.
//  - ▶ FAB → onFocusPress(그룹방이 FocusCategory{initialGroupId}로 진입시킴): 그 그룹 집중 세션이 기본.
//  - 4탭(홈/리그/그룹/전체) → Main 탭으로 이동. 그룹방에서 왔으므로 '그룹' 탭을 활성 표시(정적 하이라이트).
// 상수·barPath는 components/TabBar.tsx와 동일 값(비주얼 일치) — TabBar가 export하지 않아 복제한다.

const BAR_H = 56;
const BAR_R = 28;
const FAB_R = 28;
const NOTCH_R = FAB_R + 5;
const FAB_LIFT = -8;
const BAR_FILL = 'rgba(252,250,246,0.55)';
const BAR_STROKE = 'rgba(255,255,255,0.75)';
const HIGHLIGHT_W = 60;
const HIGHLIGHT_H = 38;
const FAB_SLOT = 72;

// 그룹방 하단바가 차지하는 세로 공간 — 스크롤 콘텐츠가 바 뒤에 가리지 않게 하단 여백에 더한다.
export const GROUP_BOTTOM_BAR_SPACE = BAR_H + T.space.sm;

function tabCenterX(w: number, index: number): number {
  const tabW = (w - 16 - FAB_SLOT) / 4;
  return 8 + tabW * (index + 0.5) + (index >= 2 ? FAB_SLOT : 0);
}

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

type IconName = keyof typeof Ionicons.glyphMap;
function TabBtn({
  name,
  icon,
  active,
  onPress,
}: {
  name: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={`grouproom.tab.${name}`}
      style={s.tab}
      scaleTo={active ? 1 : 0.9}
      onPress={active ? () => {} : onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={name}
    >
      <Ionicons name={icon} size={26} color={active ? T.accent : T.inkMuted} />
    </PressableScale>
  );
}

export function GroupRoomBottomBar({ onFocusPress }: { onFocusPress: () => void }) {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const [barW, setBarW] = useState(0);

  // 그룹방(스택) → Main 탭 셸의 해당 탭으로. 그룹방은 pop 되고 그 탭이 열린다.
  // Main 파라미터는 undefined 타입이라 중첩 네비는 캐스팅으로 넘긴다(RN 런타임은 지원).
  const goTab = (name: string) => {
    // 결과성 push가 lazy 그룹 목록을 건너뛴 경우의 `return` 표식은 방을 닫아 그룹 목록으로
    // 돌아갈 때만 유효하다. 홈/리그/전체로 흐름을 끝내면 나중의 직접 그룹 탭 진입을 오염시키지
    // 않도록 먼저 폐기한다.
    discardInitialGroupRoomReturn();
    (nav.navigate as unknown as (n: string, p?: object) => void)('Main', { screen: name });
  };

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
          // '그룹' 탭(index 2) 아래 정적 하이라이트 알약 — 그룹방이므로 그룹 탭 활성.
          <View
            style={[
              s.highlight,
              { transform: [{ translateX: tabCenterX(barW, 2) - HIGHLIGHT_W / 2 }] },
            ]}
          />
        )}
        <TabBtn name="홈" icon="home-outline" active={false} onPress={() => goTab('홈')} />
        <TabBtn name="리그" icon="trophy-outline" active={false} onPress={() => goTab('리그')} />
        <View style={s.fabSlot} />
        <TabBtn name="그룹" icon="people" active onPress={() => {}} />
        <TabBtn name="전체" icon="menu-outline" active={false} onPress={() => goTab('전체')} />
      </View>

      {/* 중앙 FAB — 이 그룹의 집중 세션 시작(그룹 페이지 기본) */}
      <PressableScale
        testID="grouproom.fab"
        style={s.fab}
        scaleTo={0.94}
        haptic="light"
        onPress={onFocusPress}
      >
        <View style={s.fabInner}>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.space.sm,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tab: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
  fabSlot: { width: FAB_SLOT },
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
  fab: {
    position: 'absolute',
    top: 8 - FAB_LIFT - FAB_R,
    alignSelf: 'center',
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
