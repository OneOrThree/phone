import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { hm } from '@/v2/screens/stats/format';

// 집중 결과 화면(GROMO-598) — 세션 종료 직후. 첫 완료/이후 세션 2변형.
// 로컬 데이터만: 이번 집중 시간(param) + 첫 완료 여부(로컬 플래그). 코인은 표기하지 않는다(설계 결정).
// 이번 주 집중 통계(서버 stats)는 GROMO-603에서 이 화면에 얹는다.

export default function FocusResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusResult'>>();
  const { focusSeconds, subjectName } = params;

  const [firstTime, setFirstTime] = useState(false);

  // 첫 완료 판별 — 로컬 플래그. 없으면 이번이 첫 완료로 보고 플래그를 남긴다.
  useEffect(() => {
    (async () => {
      const done = await AsyncStorage.getItem(STORAGE_KEYS.focusFirstDone);
      setFirstTime(done == null);
      if (done == null) AsyncStorage.setItem(STORAGE_KEYS.focusFirstDone, '1').catch(() => {});
    })();
  }, []);

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
