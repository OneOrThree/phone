import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { T, inkBox } from '../components/theme';
import { Character2D } from '../components/Character2D';
import { useFocus } from '../contexts/FocusContext';

function formatFocusTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분`;
  return `${totalSeconds}초`;
}

function StatRow({ label, value, accent }) {
  return (
    <View style={[s.statRow, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

export default function MyPageScreen() {
  const { todayFocusSeconds } = useFocus();

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      <Text style={s.title}>마이페이지 🐾</Text>

      {/* Profile card */}
      <View style={[s.profileCard, inkBox(T.yellow, '-0.5deg')]}>
        <View style={s.profileRow}>
          <View style={s.avatarWrap}>
            <Character2D size={72} />
          </View>
          <View style={s.profileInfo}>
            <Text style={s.nickname}>집중왕 🌟</Text>
            <Text style={s.joinDate}>함께한 지 1일째</Text>
          </View>
        </View>
      </View>

      {/* Stats card */}
      <View style={[s.statsCard, inkBox(T.paperDark)]}>
        <Text style={s.statsTitle}>나의 기록 ✦</Text>
        <StatRow label="오늘 집중 시간" value={formatFocusTime(todayFocusSeconds)} accent={T.coral} />
        <StatRow label="연속 집중일" value="1일" accent={T.mint} />
        <StatRow label="이번 주 목표 달성" value="0 / 7일" accent={T.sky} />
      </View>

      {/* Deco */}
      <Text style={s.deco}>★ 꾸준히 하면 방이 커져요 ★</Text>

      <View style={[s.tipCard, inkBox(T.mint, '0.6deg')]}>
        <Text style={s.tipTitle}>🍅 포모도로 기법</Text>
        <Text style={s.tipText}>
          25분 집중 → 5분 휴식을 반복해봐요.{'\n'}
          짧게 끊을수록 더 오래 집중할 수 있어요!
        </Text>
      </View>
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
    marginBottom: 18,
  },

  profileCard: {
    padding: 18,
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 80,
    height: 90,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  profileInfo: {
    flex: 1,
  },
  nickname: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
  },
  joinDate: {
    fontSize: 13,
    color: T.inkMed,
    marginTop: 4,
  },

  statsCard: {
    padding: 18,
    marginBottom: 14,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 14,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: T.paper,
    borderRadius: 8,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
  },

  deco: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: T.inkLight,
    letterSpacing: 1,
    marginBottom: 14,
  },

  tipCard: {
    padding: 16,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
    lineHeight: 20,
  },
});
