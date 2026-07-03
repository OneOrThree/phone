import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TabParamList, RootStackParamList } from '@/types/navigation';
import type { UserProfile } from '@/types/api';
import { initAnalytics } from '@/services/analytics';
import HomeScreen from '@/screens/Homescreen';
import GroupListScreen from '@/screens/GroupListScreen';
import ShopScreen from '@/screens/ShopScreen';
import MyPageScreen from '@/screens/MyPageScreen';
import FocusModeScreen from '@/screens/FocusModeScreen';
import FocusCategoryScreen from '@/screens/FocusCategoryScreen';
import GroupRoomScreen from '@/screens/GroupRoomScreen';
import MemberCalendarScreen from '@/screens/group/MemberCalendarScreen';
import { MorphingTabBar } from '@/components/MorphingTabBar';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  user: UserProfile;
  onLogout: () => void;
  onWithdraw: () => Promise<void>;
}

// 인증된 사용자에게 보여줄 루트 네비게이션 (탭 + 숨김 스택 화면).
// 인증/온보딩 게이팅과 Provider 중첩은 App.tsx가 담당한다.
export function RootNavigator({ user, onLogout, onWithdraw }: RootNavigatorProps) {
  return (
    <NavigationContainer
      onReady={() => {
        // 디바이스 ID 확보 + 공통 파라미터 부착(1회). 모듈 미링크 시 no-op.
        initAnalytics();
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs">
          {() => (
            <Tab.Navigator
              initialRouteName="홈"
              tabBar={(props) => <MorphingTabBar {...props} />}
              screenOptions={{ headerShown: false }}
            >
              <Tab.Screen name="홈" component={HomeScreen} />
              <Tab.Screen name="그룹" component={GroupListScreen} />
              <Tab.Screen
                name="상점"
                component={ShopScreen}
                options={{ tabBarButton: () => null }}
              />
              <Tab.Screen name="마이페이지">
                {() => <MyPageScreen user={user} onLogout={onLogout} onWithdraw={onWithdraw} />}
              </Tab.Screen>
              <Tab.Screen
                name="FocusCategoryScreen"
                component={FocusCategoryScreen}
                options={{ tabBarButton: () => null }}
              />
              <Tab.Screen
                name="FocusMode"
                component={FocusModeScreen}
                options={{ tabBarButton: () => null }}
              />
              <Tab.Screen
                name="GroupDetail"
                component={GroupRoomScreen}
                options={{ tabBarButton: () => null }}
              />
            </Tab.Navigator>
          )}
        </Stack.Screen>
        <Stack.Screen
          name="MemberCalendar"
          component={MemberCalendarScreen}
          options={{ presentation: 'transparentModal', animation: 'none' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
