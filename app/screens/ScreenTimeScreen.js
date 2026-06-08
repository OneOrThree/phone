import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '../components/theme';

export default function ScreenTimeScreen() {
  return (
    <View style={s.container}>
      <Text style={s.title}>스크린 타임</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: T.ink,
  },
});
