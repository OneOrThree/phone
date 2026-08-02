import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '@/screens/HomeScreen';
import StatsScreen from '@/screens/StatsScreen';
import MenuScreen from '@/screens/MenuScreen';
import UsageDetailScreen from '@/screens/UsageDetailScreen';
import NotificationsScreen from '@/screens/NotificationsScreen';
import FocusCategoryScreen from '@/screens/focus/FocusCategoryScreen';
import FocusSessionScreen from '@/screens/focus/FocusSessionScreen';
import FocusResultScreen from '@/screens/focus/FocusResultScreen';
import {
  GroupScreen,
  GroupCreateScreen,
  GroupRoomRouteScreen,
  NoticeScreen,
  GroupSettingsScreen,
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
import { startDatadogNavigationTracking } from '@/services/datadog';
import type { V2RootStackParamList } from '@/navigation/types';
import { navigationRef, flushPendingDeepLink } from '@/navigation/navigationRef';

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

export function RootNavigator() {
  // 외부 링크 수신은 이 컴포넌트가 하지 않는다 — 인증된 user가 있을 때만 렌더되는 트리라
  // 로그인 전에 도착한 초대 링크를 놓친다. 구독은 App.tsx 루트의 <DeepLinkGate/>가 맡고,
  // 여기서는 컨테이너 준비 후 버퍼를 흘려보내는 일(onReady)만 한다(§6-6).
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        // GA4 초기화 — 디바이스 ID 확보 + 공통 파라미터 부착(1회). 모듈 미링크 시 no-op.
        initAnalytics();
        // Datadog RUM 화면 추적(GROMO-928) — 화면 전환을 RUM 뷰로 기록. 키 미설정 시 no-op.
        startDatadogNavigationTracking();
        // 앱 종료 상태에서 알림으로 실행된 경우 — 버퍼된 딥링크를 컨테이너 준비 후 처리.
        flushPendingDeepLink();
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="UsageDetail" component={UsageDetailScreen} />
        {/* 알림 보관함(GROMO-661) — 홈 우측 상단 종에서 진입 */}
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
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
        {/* 그룹 운영(3차) — 방장 전용. 그룹방 ⋯ '그룹 설정'(GroupSettings)이 관리 허브이며
            여기서 위임·멤버관리·공지권한으로 갈라진다 */}
        <Stack.Screen name="GroupSettings" component={GroupSettingsScreen} />
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
        {/* 캐릭터 고르기 — 홈 '캐릭터 바꾸기'에서 진입. 기본/내 캐릭터 장착 선택 */}
        <Stack.Screen name="CharacterSelect" component={CharacterSelectScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
