import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '@/v2/screens/HomeScreen';

// v2 새 UI 네비게이터 — 새 기획의 탭 구조를 여기서 잡는다.
// 데이터/로직 층(@/store, @/services, @/types)은 기존 것을 그대로 공유한다.
// 기존 @/navigation/RootNavigator 는 참고용으로 보존한다.
type V2TabParamList = {
  홈: undefined;
};

const Tab = createBottomTabNavigator<V2TabParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="홈" component={HomeScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
