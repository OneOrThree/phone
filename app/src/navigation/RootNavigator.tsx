import { useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TabParamList, RootStackParamList } from '@/types/navigation';
import type { UserProfile } from '@/types/api';
import { initAnalytics, logScreenView } from '@/services/analytics';
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

// 라우트 이름 → GA4 screen_name(snake_case). 한글 탭/스택 이름을 분석용 표기로 매핑.
// 매핑이 없으면 원본 라우트 이름을 그대로 사용한다.
const SCREEN_NAME_MAP: Record<string, string> = {
  홈: 'home',
  그룹: 'group_list',
  상점: 'shop',
  마이페이지: 'my_page',
  FocusCategoryScreen: 'focus_category',
  FocusMode: 'focus_mode',
  GroupDetail: 'group_detail',
  MemberCalendar: 'member_calendar',
};

interface RootNavigatorProps {
  user: UserProfile;
  onLogout: () => void;
  onWithdraw: () => Promise<void>;
}

// 인증된 사용자에게 보여줄 루트 네비게이션 (탭 + 숨김 스택 화면).
// 인증/온보딩 게이팅과 Provider 중첩은 App.tsx가 담당한다.
export function RootNavigator({ user, onLogout, onWithdraw }: RootNavigatorProps) {
  const navRef = useNavigationContainerRef();
  const routeNameRef = useRef<string | undefined>(undefined);

  // 라우트가 바뀔 때만 GA4 screen_view를 발행한다(중복 방지).
  function emitScreenView() {
    const name = navRef.getCurrentRoute()?.name;
    if (name && name !== routeNameRef.current) {
      logScreenView(SCREEN_NAME_MAP[name] ?? name);
    }
    routeNameRef.current = name;
  }

  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => {
        initAnalytics(); // GA4 표준 이벤트에도 공통 파라미터 부착(1회). Phase 1에서는 no-op.
        emitScreenView(); // onStateChange는 변경 시에만 발화 → 최초 화면은 여기서 1회 기록.
      }}
      onStateChange={emitScreenView}
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
