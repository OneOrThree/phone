import { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLogoutHandler, getUserIdFromToken, apiFetch } from './utils/api';

const GENDER_MAP = { male: 'MALE', female: 'FEMALE', other: 'UNKNOWN' };

async function syncOnboardingToServer(onboardingData) {
  if (!onboardingData) return;
  const body = {
    nickname: onboardingData.nickname,
    gender: GENDER_MAP[onboardingData.gender] ?? 'UNKNOWN',
    birthDate: onboardingData.birthday,
    dailyScreenTimeGoalMinutes: Math.round((onboardingData.goalSeconds ?? 0) / 60),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayStartTime: onboardingData.dayStartTime ?? '00:00',
    dayEndTime: onboardingData.dayEndTime ?? '00:00',
    reportTime: onboardingData.reportTime ?? '00:00',
  };
try {
    const res = await apiFetch('/api/v1/user', { method: 'POST', body: JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
} catch (e) {
}
}

import { FocusProvider } from './contexts/FocusContext';
import { EquipmentProvider } from './contexts/EquipmentContext';
import { CoinProvider } from './contexts/CoinContext';
import { UserProvider } from './contexts/UserContext';

import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/Homescreen';
import GroupListScreen from './screens/GroupListScreen';
import ShopScreen from './screens/ShopScreen';
import MyPageScreen from './screens/MyPageScreen';
import FocusModeScreen from './screens/FocusModeScreen';
import FocusCategoryScreen from './screens/FocusCategoryScreen';
import GroupRoomScreen from './screens/GroupRoomScreen';
import MemberCalendarScreen from './screens/group/MemberCalendarScreen';

import { T } from './components/theme';
import { MorphingTabBar } from './components/MorphingTabBar';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnboarding, setPendingOnboarding] = useState(false);
  const [onboardingGoalSeconds, setOnboardingGoalSeconds] = useState(null);
  const [showGuestOnboarding, setShowGuestOnboarding] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('gromo:user');
      if (!raw) {
        setLoading(false);
        return;
      }
      const data = JSON.parse(raw);
      const userId = getUserIdFromToken(data.accessToken);
      try {
        const profileRes = await apiFetch('/api/v1/user');
        if (profileRes.ok) {
          const profile = await profileRes.json();
          const merged = { ...data, ...profile };
          await AsyncStorage.setItem('gromo:user', JSON.stringify(merged));
          setUser({ ...merged, userId });
        } else {
          setUser({ ...data, userId });
        }
      } catch {
        // 오프라인 등 실패 시 캐시 사용
        setUser({ ...data, userId });
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogout() {
    try {
      const refreshToken = await AsyncStorage.getItem('gromo:refreshToken');
      if (refreshToken) {
        await apiFetch('/api/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch {}
    await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
    setUser(null);
  }

  async function handleWithdraw() {
    const res = await apiFetch('/api/v1/user', { method: 'DELETE' });
    if (res.status === 400) {
      throw new Error('400');
    }
    if (!res.ok) {
      throw new Error('error');
    }
    await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
    setUser(null);
  }

  useEffect(() => {
    setLogoutHandler(handleLogout);
  }, []);

  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={T.ink} />
      </View>
    );
  }

  if (pendingOnboarding) {
    return (
      <OnboardingScreen
        onComplete={(data) => {
          setOnboardingGoalSeconds(data.goalSeconds);
          setUser((prev) => ({ ...prev, nickname: data.nickname }));
          setPendingOnboarding(false);
          syncOnboardingToServer(data);
        }}
      />
    );
  }

  if (showGuestOnboarding) {
    return (
      <OnboardingScreen
        onComplete={(data) => {
          setOnboardingGoalSeconds(data.goalSeconds);
          setShowGuestOnboarding(false);
          setUser({ nickname: data.nickname, userId: null, isNewUser: false });
        }}
      />
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={(u) => {
          const userId = getUserIdFromToken(u.accessToken);
          setUser({ ...u, userId });
          if (u.isNewUser) setPendingOnboarding(true);
        }}
        onGuestStart={() => setShowGuestOnboarding(true)}
      />
    );
  }

  return (
    <UserProvider
      initialNickname={user?.nickname}
      initialUserId={user?.userId}
      initialGoalSeconds={
        onboardingGoalSeconds ??
        (user?.dailyScreenTimeGoalMinutes ? user.dailyScreenTimeGoalMinutes * 60 : null)
      }
      initialIsNewUser={user?.isNewUser}
    >
      <CoinProvider>
        <EquipmentProvider>
          <FocusProvider>
            <NavigationContainer>
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
                        {() => (
                          <MyPageScreen user={user} onLogout={handleLogout} onWithdraw={handleWithdraw} />
                        )}
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
                  options={{ presentation: 'transparentModal', animation: 'fade' }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </FocusProvider>
        </EquipmentProvider>
      </CoinProvider>
    </UserProvider>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
});
