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
import {
  LeagueScreen,
  FriendAddScreen,
  FriendProfileScreen,
  TierGuideScreen,
  LeagueResultScreen,
} from '@/v2/screens/league';
import { TabBar } from '@/components/TabBar';
import { T } from '@/constants/theme';
import { initAnalytics } from '@/services/analytics';
import type { V2RootStackParamList } from '@/navigation/types';

// 메인 네비게이터 — 시안 "메인 4탭 + 중앙 FAB" 구조.
// 그룹 탭만 placeholder(별도 티켓), 나머지는 구현 완료. 데이터 층은 @/store 공유.
type TabParamList = {
  홈: undefined;
  리그: undefined;
  그룹: undefined;
  전체: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
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
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="홈" component={HomeScreen} />
      <Tab.Screen name="리그" component={LeagueScreen} />
      <Tab.Screen name="그룹">{() => <Placeholder title="그룹" />}</Tab.Screen>
      <Tab.Screen name="전체" component={MenuScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer
      onReady={() => {
        // GA4 초기화 — 디바이스 ID 확보 + 공통 파라미터 부착(1회). 모듈 미링크 시 no-op.
        initAnalytics();
      }}
    >
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
        <Stack.Screen name="FriendAdd" component={FriendAddScreen} />
        <Stack.Screen name="FriendProfile" component={FriendProfileScreen} />
        <Stack.Screen name="TierGuide" component={TierGuideScreen} />
        {/* 승격/강등 연출 — 풀스크린 다크라 페이드 전환 */}
        <Stack.Screen
          name="LeagueResult"
          component={LeagueResultScreen}
          options={{ animation: 'fade' }}
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
