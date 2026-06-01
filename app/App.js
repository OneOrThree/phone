import { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FocusProvider } from './contexts/FocusContext';
import { EquipmentProvider } from './contexts/EquipmentContext';
import { CoinProvider } from './contexts/CoinContext';
import { UserProvider } from './contexts/UserContext';

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

  useEffect(() => {
    AsyncStorage.getItem('gromo:user').then((raw) => {
      if (raw) setUser(JSON.parse(raw));
      setLoading(false);
    });
  }, []);

  async function handleLogout() {
    await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
    setUser(null);
  }

  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={T.ink} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={(u) => setUser(u)} />;
  }

  return (
    <UserProvider initialNickname={user?.nickname}>
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
