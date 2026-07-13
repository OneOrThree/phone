import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { getStreak } from '@/services/statsApi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@/store/UserContext';
import { STORAGE_KEYS } from '@/types/storage';
import { CharacterImage } from '@/components/character/CharacterImage';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// v2 '전체' 탭 = 설정 허브(SET·앱 설정). 프로필 헤더 + 시안 행 그룹 + 광고 배너.
// 실제 동작(목표 편집·허용앱·스크린타임·로그아웃 등)은 각 하위 화면(settings/*)이 담당하고,
// 허브는 진입점만 제공한다. (기존 MenuScreen 로직은 하위 화면으로 이전·재사용)

// 초 → "N시간"/"N시간 M분" (행 sub 요약용)
function hLabel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

const APP_VERSION = Constants.expoConfig?.version ?? '—';

export default function MenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { nickname, goalSeconds, screenTimeGoalSeconds } = useUser();
  const insets = useSafeAreaInsets();

  // 허브 행 우측 요약값 — 준비 시험 / 허용앱 개수 / 스크린타임 권한 상태.
  const [category, setCategory] = useState<string | null>(null); // 준비 시험(focusCategory)
  const [allowedApps, setAllowedApps] = useState<number | null>(null);
  const [permission, setPermission] = useState<'approved' | 'denied' | 'notDetermined' | null>(
    null,
  );
  // 연속 공부 일수(하루 10분 스트릭, GROMO-630) — 0이면 pill 생략.
  const [streakDays, setStreakDays] = useState(0);

  // 화면 재진입마다 최신값 반영(하위 화면에서 바꾸고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      ScreenTimeModule.getAllowedSelectionCounts()
        .then((c) => !cancelled && setAllowedApps(c?.applications ?? 0))
        .catch(() => !cancelled && setAllowedApps(0));
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => !cancelled && setPermission(st))
        .catch(() => !cancelled && setPermission(null));
      AsyncStorage.getItem(STORAGE_KEYS.focusCategory)
        .then((c) => !cancelled && setCategory(c))
        .catch(() => {});
      // 연속 공부 일수(GROMO-630) — 재진입마다 최신화.
      getStreak()
        .then((v) => !cancelled && setStreakDays(v.currentStreak))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const permissionLabel =
    permission === 'approved' ? '허용됨' : permission === 'denied' ? '거부됨' : '요청 필요';

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>전체</Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 헤더 — 탭하면 프로필 편집 */}
        <TouchableOpacity
          style={s.profile}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('SettingsProfileEdit')}
        >
          <View style={s.avatar}>
            <CharacterImage size={44} />
          </View>
          <View style={s.flex1}>
            <View style={s.nameRow}>
              <Text style={[s.profileName, s.nameShrink]} numberOfLines={1}>
                {nickname}
              </Text>
              {/* 연속 공부(GROMO-630) — 하루 10분 스트릭. 0일이면 생략 */}
              {streakDays > 0 && (
                <View style={s.streakPill}>
                  <Ionicons name="flame" size={10} color={T.accentDeep} />
                  <Text style={s.streakPillText}>연속 공부 {streakDays}일</Text>
                </View>
              )}
            </View>
            <Text style={s.profileSub} numberOfLines={1}>
              {category ? `${category} 준비 중` : '프로필 편집'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={T.inkMuted} />
        </TouchableOpacity>

        <SettingsSection title="집중 · 목표">
          <SettingsRow
            icon="school-outline"
            iconColor={T.accentDeep}
            iconBg={T.accentBg}
            label="준비 시험"
            value={category ?? '미설정'}
            onPress={() => navigation.navigate('SettingsOccupation')}
          />
          <SettingsRow
            icon="flag-outline"
            iconColor={T.accentDeep}
            iconBg={T.accentBg}
            label="개인 목표 수정"
            sub={`집중 ${hLabel(goalSeconds)} · 사용 ${hLabel(screenTimeGoalSeconds)}`}
            onPress={() => navigation.navigate('SettingsGoals')}
          />
          <SettingsRow
            icon="lock-open-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label="집중 중 허용 앱 관리"
            sub={
              allowedApps === null
                ? '집중 중에도 쓸 수 있는 앱'
                : allowedApps > 0
                  ? `앱 ${allowedApps}개 허용 중`
                  : '허용앱 없음'
            }
            onPress={() => navigation.navigate('SettingsAllowedApps')}
          />
          <SettingsRow
            icon="phone-portrait-outline"
            iconColor={T.accent}
            iconBg={T.accentBg}
            label="스크린타임 권한"
            value={permission === null ? undefined : permissionLabel}
            valueColor={permission === 'approved' ? T.successInk : T.inkSub}
            onPress={() => navigation.navigate('SettingsScreenTimePermission')}
          />
        </SettingsSection>

        <SettingsSection title="알림 · 공개">
          <SettingsRow
            icon="notifications-outline"
            iconColor={T.accentDeep}
            iconBg={T.sandLight}
            label="알림 설정"
            sub="집중 리마인더 · 리그 · 심야 · 소리"
            onPress={() => navigation.navigate('SettingsNotification')}
          />
          <SettingsRow
            icon="eye-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label="통계 공개 범위"
            onPress={() => navigation.navigate('SettingsStatVisibility')}
          />
        </SettingsSection>

        <SettingsSection title="계정 · 정보">
          <SettingsRow
            icon="person-circle-outline"
            iconColor={T.accent}
            iconBg={T.accentBg}
            label="계정 설정"
            sub="소셜 연동 · 로그아웃 · 회원 탈퇴"
            onPress={() => navigation.navigate('SettingsAccount')}
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label="개인정보 처리방침"
            onPress={() => navigation.navigate('SettingsPrivacyPolicy')}
          />
          <SettingsRow
            icon="information-circle-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label="버전 정보"
            value={`v${APP_VERSION}`}
            onPress={() => navigation.navigate('SettingsVersion')}
          />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  flex1: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  headerTitle: { ...T.text.title, color: T.ink },
  body: { paddingHorizontal: 18, paddingTop: 4 },

  // 프로필 헤더
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: T.sandLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileName: { ...T.text.subtitle, color: T.ink },
  profileSub: { ...T.text.caption, color: T.inkMuted, marginTop: 3 },
  // 연속 공부 pill(GROMO-630)
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameShrink: { flexShrink: 1 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  streakPillText: { ...T.text.caption, fontSize: 10, fontWeight: '700', color: T.accentDeep },
});
