import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { T, inkBox } from '../components/theme';

export default function GroupScreen() {
  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      <Text style={s.title}>그룹 👥</Text>
      <Text style={s.sub}>같이 집중해요</Text>

      <View style={[s.card, inkBox(T.sky, '1deg')]}>
        <Text style={s.cardTitle}>준비 중이에요 ✦</Text>
        <Text style={s.cardDesc}>
          친구들과 함께{'\n'}집중 기록을 나눠봐요
        </Text>
      </View>

      <Text style={s.deco}>· · · ★ · · ·</Text>

      <View style={[s.card, inkBox(T.lavender, '-0.8deg')]}>
        <Text style={s.cardTitle}>곧 출시 예정!</Text>
        <Text style={s.cardDesc}>
          그룹 챌린지, 랭킹,{'\n'}함께 집중 타이머 등
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: T.ink,
  },
  sub: {
    fontSize: 14,
    color: T.inkMed,
    marginTop: 4,
    marginBottom: 28,
  },
  card: {
    padding: 22,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: T.inkMed,
    lineHeight: 22,
  },
  deco: {
    textAlign: 'center',
    fontSize: 14,
    color: T.inkLight,
    letterSpacing: 4,
    marginVertical: 8,
  },
});
