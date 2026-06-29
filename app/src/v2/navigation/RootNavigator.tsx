import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HomeScreen from '@/v2/screens/HomeScreen';
import { V2TabBar } from '@/v2/components/V2TabBar';
import { T } from '@/v2/constants/theme';

// v2 새 UI 네비게이터 — 시안 "메인 4탭 + 중앙 FAB" 구조.
// 홈만 실제 구현, 나머지 탭은 placeholder(각자 티켓). 데이터 층은 @/store 공유.
type V2TabParamList = {
  홈: undefined;
  리그: undefined;
  그룹: undefined;
  전체: undefined;
};

const Tab = createBottomTabNavigator<V2TabParamList>();

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

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <V2TabBar {...props} />}
      >
        <Tab.Screen name="홈" component={HomeScreen} />
        <Tab.Screen name="리그">{() => <Placeholder title="리그 & 랭킹" />}</Tab.Screen>
        <Tab.Screen name="그룹">{() => <Placeholder title="그룹" />}</Tab.Screen>
        <Tab.Screen name="전체">{() => <Placeholder title="전체" />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const ph = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { ...T.text.title, color: T.ink },
  sub: { ...T.text.label, color: T.inkSub },
});
