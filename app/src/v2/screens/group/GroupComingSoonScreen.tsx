import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import { CharacterImage } from '@/components/character/CharacterImage';
import { STORAGE_KEYS } from '@/types/storage';
import { logGroupFakedoorViewed, logGroupNotifyRequested } from '@/services/analyticsEvents';

// 그룹 탭 Fakedoor(준비중 안내) — GROMO-597.
// 실제 그룹 기능은 미구현. 탭 진입·'알림 받기' 탭을 GA4로만 측정해 수요를 검증한다(앱 only, BE 없음).
// 레거시 그룹 코드(src/screens/group/*)는 dormant 유지 — 실기능 도입 시 이 화면을 교체한다.

// 플로팅 탭바가 가리는 하단 여백(리그·홈 화면과 동일 기준)
const TAB_BAR_SPACE = 74;

// 소개 문구(정직하게 — 레거시 그룹 기능 기반). 실제 배선은 실기능 도입 시.
const FEATURES = ['그룹 만들기 · 참가', '함께 집중 · 그룹 랭킹', '서로 콕 찌르기'];

export default function GroupComingSoonScreen() {
  const insets = useSafeAreaInsets();
  const [requested, setRequested] = useState(false);

  // 진입 계측 — 탭 포커스마다 1회(수요 측정 핵심).
  useFocusEffect(
    useCallback(() => {
      logGroupFakedoorViewed();
    }, []),
  );

  // 저장된 '알림 받기' 신청 여부 조회 — 있으면 '신청 완료' 상태로 시작.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.groupNotifyRequested)
      .then((v) => {
        if (v) setRequested(true);
      })
      .catch(() => {
        // 조회 실패는 무시 — 기본(미신청) 상태로 진행.
      });
  }, []);

  // '출시되면 알림 받기' — 최초 1회만 이벤트 발사 + 로컬 저장(중복 방지).
  const onNotify = useCallback(() => {
    if (requested) return;
    logGroupNotifyRequested();
    setRequested(true);
    AsyncStorage.setItem(STORAGE_KEYS.groupNotifyRequested, '1').catch(() => {
      // 저장 실패해도 이번 세션은 '신청 완료'로 표시 — 이벤트는 이미 기록됨.
    });
  }, [requested]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.body}>
        <CharacterImage size={140} />
        <Text style={s.title}>친구들과 함께 공부해요</Text>
        <Text style={s.subtitle}>혼자보다 오래, 더 즐겁게</Text>

        <View style={s.features}>
          {FEATURES.map((f) => (
            <View key={f} style={s.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={T.green} />
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={s.badge}>
          <Ionicons name="time-outline" size={14} color={T.accentDeep} />
          <Text style={s.badgeText}>아직 준비 중이에요</Text>
        </View>
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + TAB_BAR_SPACE + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onNotify}
          disabled={requested}
          style={[s.cta, requested ? s.ctaDone : null]}
        >
          <Text style={[s.ctaText, requested ? s.ctaDoneText : null]}>
            {requested ? '신청 완료 ✓' : '출시되면 알림 받기'}
          </Text>
        </TouchableOpacity>
        {requested ? <Text style={s.doneHint}>출시되면 알려드릴게요</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  title: { ...T.text.title, color: T.ink, marginTop: 22 },
  subtitle: { ...T.text.body, color: T.inkSub, marginTop: 6 },
  features: { alignSelf: 'center', marginTop: 26, gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { ...T.text.label, color: T.ink },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 28,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { ...T.text.caption, fontWeight: '700', color: T.accentDeep },
  bottom: { paddingHorizontal: 26 },
  cta: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  ctaDone: { backgroundColor: T.sand },
  ctaText: { ...T.text.subtitle, color: T.white },
  ctaDoneText: { color: T.inkSub },
  doneHint: { ...T.text.caption, color: T.inkMuted, textAlign: 'center', marginTop: 10 },
});
