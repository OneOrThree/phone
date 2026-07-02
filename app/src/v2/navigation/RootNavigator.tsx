import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HomeScreen from '@/v2/screens/HomeScreen';
import StatsScreen from '@/v2/screens/StatsScreen';
import MenuScreen from '@/v2/screens/MenuScreen';
import UsageDetailScreen from '@/v2/screens/UsageDetailScreen';
import FocusCategoryScreen from '@/v2/screens/focus/FocusCategoryScreen';
import FocusSessionScreen from '@/v2/screens/focus/FocusSessionScreen';
import { V2TabBar } from '@/v2/components/V2TabBar';
import { T } from '@/v2/constants/theme';
import type { V2RootStackParamList } from '@/v2/navigation/types';

// v2 새 UI 네비게이터 — 시안 "메인 4탭 + 중앙 FAB" 구조.
// 홈만 실제 구현, 나머지 탭은 placeholder(각자 티켓). 데이터 층은 @/store 공유.
type V2TabParamList = {
  홈: undefined;
  리그: undefined;
  그룹: undefined;
  전체: undefined;
};

const Tab = createBottomTabNavigator<V2TabParamList>();
const Stack = createNativeStackNavigator<V2RootStackParamList>();

// 미구현 탭 placeholder
function Placeholder({ title }: { title: string }) {
  return (
    <SafeAreaView style={ph.root} edges={['top']}>
      <View style={ph.center}>
        <Text style={ph.title}>{title}</Text>
        <Text style={ph.sub}>준비 중</Text>
      </View>
    </SafeAreaView>
  );
}

// 4탭 + 중앙 FAB
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <V2TabBar {...props} />}
    >
      <Tab.Screen name="홈" component={HomeScreen} />
      <Tab.Screen name="리그">{() => <Placeholder title="리그 & 랭킹" />}</Tab.Screen>
      <Tab.Screen name="그룹">{() => <Placeholder title="그룹" />}</Tab.Screen>
      <Tab.Screen name="전체" component={MenuScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="UsageDetail" component={UsageDetailScreen} />
        {/* 집중 플로우 — FAB → 과목선택 → 세션 (탭 위 push) */}
        <Stack.Screen name="FocusCategory" component={FocusCategoryScreen} />
        <Stack.Screen
          name="FocusSession"
          component={FocusSessionScreen}
          options={{ gestureEnabled: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const ph = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { ...T.text.title, color: T.ink },
  sub: { ...T.text.label, color: T.inkSub },
});
