import { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
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
  console.log('[온보딩 전송]', JSON.stringify(body, null, 2));
  try {
    const res = await apiFetch('/api/v1/user', { method: 'POST', body: JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    console.log('[온보딩 응답]', res.status, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[온보딩 실패]', e);
  }
}

import { FocusProvider } from './contexts/FocusContext';
import { EquipmentProvider } from './contexts/EquipmentContext';
import { CoinProvider } from './contexts/CoinContext';
import { UserProvider } from './contexts/UserContext';

import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/Homescreen';
import GroupScreen from './screens/GroupScreen';
import ShopScreen from './screens/ShopScreen';
import MyPageScreen from './screens/MyPageScreen';
import FocusModeScreen from './screens/FocusModeScreen';
import FocusCategoryScreen from './screens/FocusCategoryScreen';

import { T } from './components/theme';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  홈: '🏠',
  그룹: '👥',
  상점: '🛍',
  마이페이지: '🐾',
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnboarding, setPendingOnboarding] = useState(false);
  const [onboardingGoalSeconds, setOnboardingGoalSeconds] = useState(null);
  const [showGuestOnboarding, setShowGuestOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('gromo:user').then((raw) => {
      if (raw) {
        const data = JSON.parse(raw);
        const userId = getUserIdFromToken(data.accessToken);
        setUser({ ...data, userId });
      }
      setLoading(false);
    });
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
              <Tab.Navigator
                initialRouteName="홈"
                screenOptions={({ route }) => ({
                  headerShown: false,
                  tabBarIcon: ({ focused }) => (
                    <Text style={focused ? s.tabIconFocused : s.tabIcon}>
                      {TAB_ICONS[route.name] ?? ''}
                    </Text>
                  ),
                  tabBarActiveTintColor: T.ink,
                  tabBarInactiveTintColor: T.inkLight,
                  tabBarStyle: ['FocusMode', 'FocusCategoryScreen'].includes(route.name)
                    ? { display: 'none' }
                    : {
                        backgroundColor: T.paper,
                        borderTopColor: T.ink,
                        borderTopWidth: 2.5,
                        height: 76,
                        paddingBottom: 10,
                        paddingTop: 6,
                        marginBottom: 8,
                      },
                  tabBarLabelStyle: {
                    fontSize: 11,
                    fontWeight: '700',
                  },
                })}
              >
                <Tab.Screen name="홈" component={HomeScreen} />
                <Tab.Screen name="그룹" component={GroupScreen} />
                <Tab.Screen name="상점" component={ShopScreen} />
                <Tab.Screen name="마이페이지">
                  {() => <MyPageScreen user={user} onLogout={handleLogout} />}
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
              </Tab.Navigator>
            </NavigationContainer>
          </FocusProvider>
        </EquipmentProvider>
      </CoinProvider>
    </UserProvider>
  );
}

const s = StyleSheet.create({
  tabIcon: { fontSize: 18 },
  tabIconFocused: { fontSize: 22 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
});
