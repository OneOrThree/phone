import { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLogoutHandler, getUserIdFromToken } from './utils/api';

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
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [onboardingData, setOnboardingData] = useState(null);
  const [showGuestOnboarding, setShowGuestOnboarding] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('gromo:onboardingDone'),
      AsyncStorage.getItem('gromo:onboarding'),
      AsyncStorage.getItem('gromo:user'),
    ]).then(([done, onboarding, userRaw]) => {
      setOnboardingDone(done === 'true');
      if (onboarding) setOnboardingData(JSON.parse(onboarding));
      if (userRaw) {
        const data = JSON.parse(userRaw);
        const userId = getUserIdFromToken(data.accessToken);
        setUser({ ...data, userId });
      }
      setLoading(false);
    });
  }, []);

  async function handleLogout() {
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

  if (!onboardingDone) {
    return (
      <OnboardingScreen
        onComplete={(data) => {
          setOnboardingData(data);
          setOnboardingDone(true);
        }}
      />
    );
  }

  if (showGuestOnboarding) {
    return (
      <OnboardingScreen
        onComplete={(data) => {
          setOnboardingData(data);
          setShowGuestOnboarding(false);
          setUser({ nickname: '게스트', userId: null, isNewUser: false });
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
        }}
        onGuestStart={() => setShowGuestOnboarding(true)}
      />
    );
  }

  return (
    <UserProvider
      initialNickname={user?.nickname}
      initialUserId={user?.userId}
      initialGoalSeconds={onboardingData?.goalSeconds}
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
                  tabBarStyle:
                    route.name === 'FocusMode'
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
