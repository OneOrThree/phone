import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '@/screens/HomeScreen';
import StatsScreen from '@/screens/StatsScreen';
import MenuScreen from '@/screens/MenuScreen';
import UsageDetailScreen from '@/screens/UsageDetailScreen';
import NotificationsScreen from '@/screens/NotificationsScreen';
import CurrencyHistoryScreen from '@/screens/currency/CurrencyHistoryScreen';
import FocusCategoryScreen from '@/screens/focus/FocusCategoryScreen';
import FocusSessionScreen from '@/screens/focus/FocusSessionScreen';
import FocusResultScreen from '@/screens/focus/FocusResultScreen';
import {
  GroupScreen,
  GroupCreateScreen,
  GroupRoomRouteScreen,
  NoticeScreen,
  GroupChallengeHistoryScreen,
  GroupSettingsScreen,
  GroupCardEmojiEditScreen,
  GroupProfileEditScreen,
  GroupMemberManageScreen,
  GroupOwnerTransferScreen,
  GroupNoticePermissionScreen,
} from '@/screens/group';
import {
  LeagueScreen,
  FriendAddScreen,
  FriendProfileScreen,
  TierGuideScreen,
  LeagueResultScreen,
} from '@/screens/league';
import {
  ProfileEditScreen,
  OccupationScreen,
  AccountScreen,
  GoalsScreen,
  AllowedAppsScreen,
  ScreenTimePermissionScreen,
  NotificationSettingsScreen,
  StatVisibilityScreen,
  PrivacyPolicyScreen,
  VersionInfoScreen,
} from '@/screens/settings';
import CharacterCreateRoute from '@/screens/character/CharacterCreateRoute';
import CharacterSelectScreen from '@/screens/character/CharacterSelectScreen';
import { TabBar } from '@/components/TabBar';
import { initAnalytics } from '@/services/analytics';
import {
  logAppMainViewed,
  logScreenExited,
  logScreenViewed,
  type AppEntry,
} from '@/services/analyticsEvents';
import { startDatadogNavigationTracking } from '@/services/datadog';
import type { V2RootStackParamList } from '@/navigation/types';
import { navigationRef, flushPendingDeepLink } from '@/navigation/navigationRef';
import { useUser } from '@/store/UserContext';

// 메인 네비게이터 — 시안 "메인 4탭 + 중앙 FAB" 구조.
// 그룹 탭은 A안 실기능(docs/app/group-plan.md) — Fakedoor(GROMO-597)를 걷어냈다. 데이터 층은 @/store 공유.
type TabParamList = {
  홈: undefined;
  리그: undefined;
  그룹: undefined;
  전체: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<V2RootStackParamList>();

// 4탭 + 중앙 FAB
function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="홈" component={HomeScreen} />
      <Tab.Screen name="리그" component={LeagueScreen} />
      <Tab.Screen name="그룹" component={GroupScreen} />
      <Tab.Screen name="전체" component={MenuScreen} />
    </Tab.Navigator>
  );
}

interface RootNavigatorProps {
  initialAppEntry?: Extract<AppEntry, 'cold_start' | 'auth_complete'>;
}

export function RootNavigator({ initialAppEntry = 'cold_start' }: RootNavigatorProps) {
  const { isGuest } = useUser();
  const screenVisitRef = useRef<{
    screen_name: string;
    route_key: string;
    entered_at: number;
  } | null>(null);
  const analyticsReadyRef = useRef(false);
  const wasBackgroundedRef = useRef(false);

  function currentTab(): 'home' | 'league' | 'group' | 'menu' {
    const root = navigationRef.getRootState();
    const main = root?.routes[root.index];
    const tabs = main?.state as { index?: number; routes?: Array<{ name: string }> } | undefined;
    const name = tabs?.routes?.[tabs.index ?? 0]?.name;
    if (name === '리그') return 'league';
    if (name === '그룹') return 'group';
    if (name === '전체') return 'menu';
    return 'home';
  }

  function enterScreen(route: { name: string; key: string }): void {
    screenVisitRef.current = {
      screen_name: route.name,
      route_key: route.key,
      entered_at: Date.now(),
    };
    logScreenViewed({ screen_name: route.name, entry_source: 'navigation' });
  }

  function exitScreen(): void {
    const visit = screenVisitRef.current;
    if (!visit) return;
    logScreenExited({
      screen_name: visit.screen_name,
      dwell_seconds: Math.max(0, Math.round((Date.now() - visit.entered_at) / 1000)),
    });
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (analyticsReadyRef.current) exitScreen();
        screenVisitRef.current = null;
        // inactive은 권한 시트·알림 센터·전화 중단일 수 있어 foreground 재진입으로 세지 않는다.
        wasBackgroundedRef.current = state === 'background';
        return;
      }
      if (state !== 'active' || !analyticsReadyRef.current) return;
      const route = navigationRef.getCurrentRoute();
      if (wasBackgroundedRef.current) {
        wasBackgroundedRef.current = false;
        if (route) enterScreen(route);
        logAppMainViewed({
          app_entry: 'foreground',
          auth_state: isGuest ? 'guest' : 'member',
          initial_tab: currentTab(),
        });
      } else if (route) {
        // inactive 동안만 멈춘 방문은 새 방문으로 세지 않고 타이머만 재개한다.
        screenVisitRef.current = { screen_name: route.name, route_key: route.key, entered_at: Date.now() };
      }
    });
    return () => {
      sub.remove();
      if (analyticsReadyRef.current) exitScreen();
    };
  }, [isGuest]);
  // 외부 링크 수신은 이 컴포넌트가 하지 않는다 — 인증된 user가 있을 때만 렌더되는 트리라
  // 로그인 전에 도착한 초대 링크를 놓친다. 구독은 App.tsx 루트의 <DeepLinkGate/>가 맡고,
  // 여기서는 컨테이너 준비 후 버퍼를 흘려보내는 일(onReady)만 한다(§6-6).
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={async () => {
        // GA4 초기화 — 디바이스 ID 확보 + 공통 파라미터 부착(1회). 모듈 미링크 시 no-op.
        await initAnalytics();
        analyticsReadyRef.current = true;
        logAppMainViewed({
          app_entry: initialAppEntry,
          auth_state: isGuest ? 'guest' : 'member',
          initial_tab: currentTab(),
        });
        const initialRoute = navigationRef.getCurrentRoute();
        if (initialRoute) enterScreen(initialRoute);
        // 분석 초기화가 끝난 뒤에 버퍼를 흘려보내 첫 화면 이벤트에도 공통 식별자가 붙는다.
        flushPendingDeepLink();
        // Datadog RUM 화면 추적(GROMO-928) — 화면 전환을 RUM 뷰로 기록. 키 미설정 시 no-op.
        startDatadogNavigationTracking();
      }}
      onStateChange={() => {
        if (!analyticsReadyRef.current) return;
        const route = navigationRef.getCurrentRoute();
        if (!route) return;
        if (screenVisitRef.current?.route_key !== route.key) {
          exitScreen();
          enterScreen(route);
        }
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="UsageDetail" component={UsageDetailScreen} />
        {/* 알림 보관함(GROMO-661) — 홈 우측 상단 종에서 진입 */}
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        {/* 시간조각(재화) 거래 내역 — '전체' 탭 잔액 행에서 진입 */}
        <Stack.Screen name="CurrencyHistory" component={CurrencyHistoryScreen} />
        {/* 집중 플로우 — FAB → 과목선택 → 세션 (탭 위 push) */}
        <Stack.Screen name="FocusCategory" component={FocusCategoryScreen} />
        <Stack.Screen
          name="FocusSession"
          component={FocusSessionScreen}
          options={{ gestureEnabled: false }}
        />
        {/* 집중 결과(GROMO-603) — 세션을 replace. 뒤로가기로 죽은 세션 복귀 방지 */}
        <Stack.Screen
          name="FocusResult"
          component={FocusResultScreen}
          options={{ gestureEnabled: false, animation: 'fade' }}
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
        {/* 그룹(A안) — 진입점은 '그룹' 탭(GroupScreen). 그룹방은 그룹이 1개면 탭 안에서 렌더되고,
            목록(2개 이상)에서 탭했을 때만 GroupRoom으로 push 된다(2차) */}
        <Stack.Screen name="GroupCreate" component={GroupCreateScreen} />
        <Stack.Screen name="GroupRoom" component={GroupRoomRouteScreen} />
        <Stack.Screen name="GroupNotice" component={NoticeScreen} />
        {/* 그룹 챌린지 내역(GROMO-1277) — 그룹방 링크(전체) · 지난 결과 시트(챌린지 필터)에서 push.
            이력의 소유자가 그룹이라 챌린지가 삭제돼도 이 화면은 살아 있다(N6-1) */}
        <Stack.Screen name="GroupChallengeHistory" component={GroupChallengeHistoryScreen} />
        {/* 그룹 운영(3차) — 방장 전용. 그룹방 ⋯ '그룹 설정'(GroupSettings)이 관리 허브이며
            여기서 위임·멤버관리·공지권한으로 갈라진다 */}
        <Stack.Screen name="GroupSettings" component={GroupSettingsScreen} />
        <Stack.Screen name="GroupCardEmojiEdit" component={GroupCardEmojiEditScreen} />
        <Stack.Screen name="GroupProfileEdit" component={GroupProfileEditScreen} />
        <Stack.Screen name="GroupMemberManage" component={GroupMemberManageScreen} />
        <Stack.Screen name="GroupOwnerTransfer" component={GroupOwnerTransferScreen} />
        <Stack.Screen name="GroupNoticePermission" component={GroupNoticePermissionScreen} />
        {/* 설정(GROMO-559) — '전체' 탭(MenuScreen) 허브에서 push 되는 하위 화면 */}
        <Stack.Screen name="SettingsProfileEdit" component={ProfileEditScreen} />
        <Stack.Screen name="SettingsOccupation" component={OccupationScreen} />
        <Stack.Screen name="SettingsAccount" component={AccountScreen} />
        <Stack.Screen name="SettingsGoals" component={GoalsScreen} />
        <Stack.Screen name="SettingsAllowedApps" component={AllowedAppsScreen} />
        <Stack.Screen name="SettingsScreenTimePermission" component={ScreenTimePermissionScreen} />
        <Stack.Screen name="SettingsNotification" component={NotificationSettingsScreen} />
        <Stack.Screen name="SettingsStatVisibility" component={StatVisibilityScreen} />
        <Stack.Screen name="SettingsPrivacyPolicy" component={PrivacyPolicyScreen} />
        <Stack.Screen name="SettingsVersion" component={VersionInfoScreen} />
        {/* 사진에서 캐릭터 만들기 — '전체' 탭 '캐릭터' 섹션에서 진입. 생성 완료 시
             CharacterContext에 커스텀 캐릭터로 저장된다(CharacterCreateRoute). */}
        <Stack.Screen name="CharacterCreate" component={CharacterCreateRoute} />
        {/* 캐릭터 변경 — 홈 '캐릭터 변경'에서 진입. 기본/내 캐릭터 장착 선택 */}
        <Stack.Screen name="CharacterSelect" component={CharacterSelectScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
