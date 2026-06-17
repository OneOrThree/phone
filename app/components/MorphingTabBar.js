import { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './theme';

const SCREEN_W = Dimensions.get('window').width;

const TABS = [
  { name: '홈', icon: '🏠' },
  { name: '그룹', icon: '👥' },
  { name: '상점', icon: '🛍' },
  { name: '마이페이지', icon: '🐾' },
];

const HIDDEN = new Set(['FocusMode', 'FocusCategoryScreen', 'GroupDetail']);
const N = TABS.length;
const TAB_W = SCREEN_W / N;
const BAR_H = 62;
const PILL_H = 44;
const PILL_W = TAB_W - 16;
const PILL_TOP = (BAR_H - PILL_H) / 2; // 수직 중앙 정렬

export function MorphingTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();

  const activeRouteName = state.routes[state.index]?.name;
  const activeIdx = TABS.findIndex((t) => t.name === activeRouteName);
  const displayIdx = activeIdx < 0 ? 0 : activeIdx;

  const pillAnim = useRef(new Animated.Value(displayIdx)).current;

  useEffect(() => {
    if (activeIdx < 0) return;
    Animated.spring(pillAnim, {
      toValue: displayIdx,
      useNativeDriver: true,
      tension: 220,
      friction: 22,
    }).start();
  }, [displayIdx, activeIdx, pillAnim]);

  if (HIDDEN.has(activeRouteName)) return null;

  const pillTranslateX = pillAnim.interpolate({
    inputRange: TABS.map((_, i) => i),
    outputRange: TABS.map((_, i) => TAB_W * i + (TAB_W - PILL_W) / 2),
  });

  return (
    // 총 높이 = 탭 콘텐츠 영역(BAR_H) + 홈 인디케이터 여백(insets.bottom)
    <View style={[s.bar, { height: BAR_H + insets.bottom }]}>
      {/* 슬라이딩 pill — BAR_H 영역 안에서 수직 중앙 정렬 */}
      <Animated.View
        pointerEvents="none"
        style={[s.pill, { transform: [{ translateX: pillTranslateX }] }]}
      />

      {/* 탭 버튼 — height: BAR_H로 고정해 safe area 영역 침범 방지 */}
      {TABS.map(({ name, icon }, idx) => {
        const isFocused = idx === displayIdx;
        const route = state.routes.find((r) => r.name === name);
        if (!route) return null;

        function onPress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(name);
          }
        }

        function onLongPress() {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        }

        return (
          <TouchableOpacity
            key={name}
            style={s.tab}
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
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: T.paper,
    borderTopWidth: 1.5,
    borderTopColor: T.ink,
    alignItems: 'flex-start', // 탭이 상단 BAR_H 영역에 고정되도록
  },
  pill: {
    position: 'absolute',
    top: PILL_TOP,
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  tab: {
    flex: 1,
    height: BAR_H, // '100%' 대신 고정값으로 safe area 영역 제외
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: { fontSize: 18, color: T.inkLight },
  iconActive: { fontSize: 20, color: T.ink },
  label: { fontSize: 11, fontWeight: '800', color: T.ink },
});
