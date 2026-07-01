import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/v2/constants/theme';
import type { V2RootStackParamList } from '@/v2/navigation/types';

// v2 커스텀 탭바 — Claude Design "01 홈" 시안: 프로스티드 바 + 4탭 + 중앙 FAB(집중 시작).
type IconPair = [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap];
const ICONS: Record<string, IconPair> = {
  홈: ['home', 'home-outline'],
  리그: ['trophy', 'trophy-outline'],
  그룹: ['people', 'people-outline'],
  전체: ['menu', 'menu-outline'],
};

export function V2TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const rootNav = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const routes = state.routes;

  function Tab({ index }: { index: number }) {
    const route = routes[index];
    if (!route) return <View style={s.tab} />;
    const focused = state.index === index;
    const [on, off] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
    return (
      <TouchableOpacity
        style={s.tab}
        activeOpacity={0.7}
        onPress={() => {
          if (!focused) navigation.navigate(route.name);
        }}
      >
        <Ionicons name={focused ? on : off} size={26} color={focused ? T.accent : '#A99B86'} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="box-none">
      <View style={s.bar}>
        <Tab index={0} />
        <Tab index={1} />
        <View style={s.fabSlot} />
        <Tab index={2} />
        <Tab index={3} />
      </View>

      {/* 중앙 FAB — 집중 시작 */}
      <TouchableOpacity
        style={s.fab}
        activeOpacity={0.85}
        onPress={() => rootNav.navigate('FocusCategory')}
      >
        <LinearGradient colors={['#E0AA5A', '#C8893F']} style={s.fabGrad}>
          <Ionicons name="flash" size={24} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(249,245,238,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    shadowColor: '#50371E',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fabSlot: { width: 64 },
  fab: {
    position: 'absolute',
    top: -8,
    alignSelf: 'center',
    ...Platform.select({ ios: {}, android: {} }),
  },
  fabGrad: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C8893F',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});
