import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import { getFocusPeriodStats, getStreak, getHeatmap } from '@/services/statsApi';
import type {
  FocusPeriodStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
} from '@/types/dto/stats';
import { todayStr } from '@/utils/localDate';
import type { V2RootStackParamList } from '@/navigation/types';
import { hm, weekdayKo, grassLevel, heatmapRange } from '@/v2/screens/stats/format';

// 집중 결과 화면 — 세션 종료 직후. 첫 완료/이후 세션 2변형.
// GROMO-598: 화면·진입·로컬 데이터(이번 집중)·CTA.
// GROMO-603(집중 완료 통계): 이번 주 집중시간·스트릭·요일 잔디(서버 stats)를 이 화면에 얹음.
// 코인은 표기하지 않는다(설계 결정).

const GRASS = ['#ECE2D1', '#DCE8CE', '#B9D3A0', '#8FB86F', T.greenDeep];

export default function FocusResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusResult'>>();
  const { focusSeconds, subjectName } = params;

  const [firstTime, setFirstTime] = useState(false);
  const [week, setWeek] = useState<FocusPeriodStatsResponse | null>(null);
  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCellResponse[]>([]);

  // 첫 완료 판별 — 로컬 플래그. 없으면 이번이 첫 완료로 보고 플래그를 남긴다.
  useEffect(() => {
    (async () => {
      const done = await AsyncStorage.getItem(STORAGE_KEYS.focusFirstDone);
      setFirstTime(done == null);
      if (done == null) AsyncStorage.setItem(STORAGE_KEYS.focusFirstDone, '1').catch(() => {});
    })();
  }, []);

  // 집중 완료 통계(GROMO-603) — 이번 주 요약.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { from, to } = heatmapRange('WEEK');
      const [w, st, h] = await Promise.all([
        getFocusPeriodStats('WEEK').catch(() => null),
        getStreak().catch(() => null),
        getHeatmap(from, to).catch(() => [] as HeatmapCellResponse[]),
      ]);
      if (cancelled) return;
      setWeek(w);
      setStreak(st);
      setHeatmap(h);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayStr();
  const focusMinutes = Math.round(focusSeconds / 60);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 헤더 — 마스코트 + 축하 문구 */}
        <View style={s.hero}>
          <CharacterImage size={130} variant="study" />
          <Text style={s.title}>{firstTime ? '첫 집중 완료!' : '집중 완료!'}</Text>
          <Text style={s.sub}>
            {firstTime ? '오늘 첫 걸음을 뗐어요 🎉' : `${subjectName} · 꾸준함이 쌓이고 있어요`}
          </Text>
        </View>

        {/* 이번 집중 시간 (코인 표기 없음) */}
        <View style={s.card}>
          <Text style={s.cardLabel}>이번 집중</Text>
          <Text style={s.bigStat}>{hm(focusMinutes)}</Text>
          <Text style={s.cardSub}>{subjectName}</Text>
        </View>

        {/* 집중 완료 통계(603) — 이번 주 집중 + 스트릭 + 요일 잔디 */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardLabel}>
              {firstTime ? '이번 주 스트릭 채우기 완료!' : '이번 주 집중시간'}
            </Text>
            {streak && streak.currentStreak > 0 ? (
              <Text style={s.streakBadge}>{streak.currentStreak}일 연속</Text>
            ) : null}
          </View>
          <Text style={[s.bigStat, { color: T.greenDeep }]}>
            {hm(week?.totalFocusMinutes ?? 0)}
          </Text>
          {heatmap.length > 0 ? (
            <View style={s.grassRow}>
              {heatmap.map((c) => (
                <View key={c.date} style={s.grassCol}>
                  <View
                    style={[
                      s.grassCell,
                      { backgroundColor: GRASS[grassLevel(c.totalFocusMinutes)] },
                    ]}
                  />
                  <Text style={[s.grassDay, c.date === today ? s.grassDayToday : null]}>
                    {weekdayKo(c.date)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* 하단 CTA — 홈으로 / 다시 집중 */}
      <View style={s.footer}>
        <TouchableOpacity
          style={s.homeBtn}
          activeOpacity={0.85}
          onPress={() => navigation.popToTop()}
        >
          <Text style={s.homeText}>홈으로</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.againBtn}
          activeOpacity={0.85}
          onPress={() => navigation.replace('FocusCategory')}
        >
          <Text style={s.againText}>다시 집중</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  scroll: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 14 },

  hero: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  title: { ...T.text.title, color: T.ink, marginTop: 6 },
  sub: { ...T.text.body, color: T.inkSub, textAlign: 'center' },

  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6,
  },
  cardLabel: { ...T.text.label, color: T.inkSub },
  cardSub: { ...T.text.caption, color: T.inkMuted },
  bigStat: { ...T.text.display, color: T.ink },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakBadge: { ...T.text.caption, color: T.accentDeep },

  grassRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  grassCol: { flex: 1, alignItems: 'center', gap: 5 },
  grassCell: { width: '100%', height: 24, borderRadius: 6 },
  grassDay: { ...T.text.caption, fontSize: 11, color: T.inkMuted },
  grassDayToday: { color: T.greenDeep, fontWeight: '800' },

  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  homeBtn: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  homeText: { ...T.text.subtitle, color: T.inkSub },
  againBtn: {
    flex: 1.4,
    backgroundColor: T.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  againText: { ...T.text.subtitle, color: T.white },
});
