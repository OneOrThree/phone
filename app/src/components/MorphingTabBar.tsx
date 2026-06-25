import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { T } from '@/constants/theme';

// 탭바가 동적으로 읽는 GroupDetail 라우트 파라미터 (느슨하게 접근)
interface TabBarRouteParams {
  chatEnabled?: boolean;
  activeTab?: string;
  groupId?: string;
  showSettings?: boolean;
}

const SCREEN_W = Dimensions.get('window').width;

const MAIN_TABS = [
  { name: '홈', icon: '🏠' },
  { name: '그룹', icon: '👥' },
  { name: '마이페이지', icon: '🐾' },
];

const GROUP_DETAIL_TABS = [
  { key: 'group', name: '그룹', icon: '👥' },
  { key: 'ranking', name: '랭킹', icon: '🏆' },
  { key: 'challenge', name: '챌린지', icon: '🎯' },
  { key: 'chat', name: '채팅', icon: '💬' },
  { key: 'notice', name: '공지', icon: '📢' },
];

const HIDDEN = new Set(['FocusMode', 'FocusCategoryScreen']);

const MAIN_N = 3;

// 플로팅 바 여백
const BAR_MARGIN_H = 12;
const BAR_MARGIN_V = 8;
const BAR_PADDING = 4;
const BAR_H = 54;
const PILL_H = BAR_H - BAR_PADDING * 2;
const BAR_RADIUS = 20;
const PILL_RADIUS = 16;

// 그룹 탭의 뒤로가기 버튼
const BACK_BTN_W = 44;
const BACK_GAP = 8;

// 각 탭 너비 (pill 위치 계산용)
const MAIN_TAB_W = (SCREEN_W - BAR_MARGIN_H * 2 - BAR_PADDING * 2) / MAIN_N;
const GROUP_BAR_W = SCREEN_W - BAR_MARGIN_H * 2 - BACK_BTN_W - BACK_GAP;

export function MorphingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const activeRouteName = state.routes[state.index]?.name ?? '';
  const isGroupDetail = activeRouteName === 'GroupDetail';
  const currentRoute = state.routes[state.index];
  const routeParams = (currentRoute?.params ?? {}) as TabBarRouteParams;

  const mainActiveIdx = MAIN_TABS.findIndex((t) => t.name === activeRouteName);
  const mainDisplayIdx = mainActiveIdx < 0 ? 0 : mainActiveIdx;

  const chatEnabled = routeParams.chatEnabled ?? true;
  const visibleGroupTabs = chatEnabled
    ? GROUP_DETAIL_TABS
    : GROUP_DETAIL_TABS.filter((t) => t.key !== 'chat');

  const groupActiveTab = routeParams.activeTab ?? 'group';
  const groupActiveIdx = visibleGroupTabs.findIndex((t) => t.key === groupActiveTab);
  const groupDisplayIdx = groupActiveIdx < 0 ? 0 : groupActiveIdx;

  const mainPillAnim = useRef(new Animated.Value(mainDisplayIdx)).current;
  const groupPillAnim = useRef(new Animated.Value(groupDisplayIdx)).current;

  useEffect(() => {
    if (isGroupDetail) return;
    Animated.spring(mainPillAnim, {
      toValue: mainDisplayIdx,
      useNativeDriver: true,
      tension: 220,
      friction: 22,
    }).start();
  }, [mainDisplayIdx, isGroupDetail, mainPillAnim]);

  useEffect(() => {
    if (!isGroupDetail) return;
    Animated.spring(groupPillAnim, {
      toValue: groupDisplayIdx,
      useNativeDriver: true,
      tension: 220,
      friction: 22,
    }).start();
  }, [groupDisplayIdx, isGroupDetail, groupPillAnim]);

  const isSettingsOpen = isGroupDetail && (routeParams.showSettings ?? false);
  if (HIDDEN.has(activeRouteName) || isSettingsOpen) return null;

  const pb = insets.bottom + BAR_MARGIN_V;

  // 그룹 상세 탭바
  if (isGroupDetail) {
    const visibleN = visibleGroupTabs.length;
    const visibleTabW = (GROUP_BAR_W - BAR_PADDING * 2) / visibleN;
    const inputRange = visibleGroupTabs.map((_, i) => i);
    const outputRange = inputRange.map((i) => BAR_PADDING + i * visibleTabW);
    const groupPillX = groupPillAnim.interpolate({ inputRange, outputRange });

    return (
      <View style={[s.outerContainer, { paddingBottom: pb }]}>
        <View style={s.groupRow}>
          {/* 뒤로가기 */}
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.navigate('그룹')}
            activeOpacity={0.7}
          >
            <Text style={s.backBtnText}>‹</Text>
          </TouchableOpacity>

          {/* 그룹 서브 탭 */}
          <View style={s.floatBarGroup}>
            <Animated.View
              pointerEvents="none"
              style={[s.pill, { width: visibleTabW, transform: [{ translateX: groupPillX }] }]}
            />
            {visibleGroupTabs.map(({ key, name, icon }, idx) => {
              const isFocused = idx === groupDisplayIdx;
              return (
                <TouchableOpacity
                  key={key}
                  style={s.tabItem}
                  onPress={() =>
                    navigation.navigate('GroupDetail', {
                      groupId: routeParams.groupId,
                      activeTab: key,
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Text style={isFocused ? s.iconActive : s.icon}>{icon}</Text>
                  {isFocused && <Text style={s.label}>{name}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  // 메인 탭바
  const mainPillX = mainPillAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, 1, 2].map((i) => BAR_PADDING + i * MAIN_TAB_W),
  });

  return (
    <View style={[s.outerContainer, { paddingBottom: pb }]}>
      <View style={s.floatBarMain}>
        <Animated.View
          pointerEvents="none"
          style={[s.pill, { width: MAIN_TAB_W, transform: [{ translateX: mainPillX }] }]}
        />
        {MAIN_TABS.map(({ name, icon }, idx) => {
          const isFocused = idx === mainDisplayIdx;

          function onPress() {
            const route = state.routes.find((r) => r.name === name);
            if (!route) return;
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(name);
          }

          function onLongPress() {
            const route = state.routes.find((r) => r.name === name);
            if (route) navigation.emit({ type: 'tabLongPress', target: route.key });
          }

          return (
            <TouchableOpacity
              key={name}
              style={s.tabItem}
              onPress={onPress}
              onLongPress={onLongPress}
              activeOpacity={0.8}
            >
              <Text style={isFocused ? s.iconActive : s.icon}>{icon}</Text>
              {isFocused && <Text style={s.label}>{name}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const floatBar: ViewStyle = {
  flexDirection: 'row',
  backgroundColor: T.paperDark,
  borderRadius: BAR_RADIUS,
  height: BAR_H,
  padding: BAR_PADDING,
  overflow: 'hidden',
};

const s = StyleSheet.create({
  outerContainer: {
    backgroundColor: T.paper,
    paddingHorizontal: BAR_MARGIN_H,
    paddingTop: BAR_MARGIN_V,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BACK_GAP,
  },

  floatBarMain: { ...floatBar },
  floatBarGroup: { ...floatBar, flex: 1 },

  // 뒤로가기 버튼 (그룹 상세)
  backBtn: {
    width: BACK_BTN_W,
    height: BAR_H,
    backgroundColor: T.paperDark,
    borderRadius: BAR_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 24, fontWeight: '700', color: T.inkMed },

  // 슬라이딩 pill
  pill: {
    position: 'absolute',
    top: BAR_PADDING,
    height: PILL_H,
    borderRadius: PILL_RADIUS,
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.paperLine,
  },

  // 탭 아이템 (메인/그룹 공통)
  tabItem: {
    flex: 1,
    height: PILL_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: { fontSize: 17, color: T.inkLight },
  iconActive: { fontSize: 19, color: T.ink },
  label: { fontSize: 11, fontWeight: '800', color: T.ink },
});
