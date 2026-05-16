import React from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { EquipmentProvider } from './contexts/EquipmentContext';

import HomeScreen from './screens/Homescreen';
import GroupScreen from './screens/GroupScreen';
import ShopScreen from './screens/ShopScreen';
import MyPageScreen from './screens/MyPageScreen';
import FocusMode from './screens/FocusMode';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <EquipmentProvider>
      <NavigationContainer>
        <Tab.Navigator
          initialRouteName="홈"
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#ffffff',
            tabBarInactiveTintColor: '#777777',
            tabBarStyle: {
              backgroundColor: '#111111',
              borderTopColor: '#333333',
              height: 64,
              paddingBottom: 8,
              paddingTop: 8,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
          }}
        >
          <Tab.Screen name="홈" component={HomeScreen} />
          <Tab.Screen name="그룹" component={GroupScreen} />
          <Tab.Screen name="상점" component={ShopScreen} />
          <Tab.Screen name="마이페이지" component={MyPageScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </EquipmentProvider>
  );
}