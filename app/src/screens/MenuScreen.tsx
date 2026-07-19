import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
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
import { GoalCelebrationModal } from '@/components/GoalCelebrationModal';
import { ScreenTimeCelebrationModal } from '@/components/ScreenTimeCelebrationModal';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
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

// GROMO-813: 법적 문서는 팀 사이트로 연결. 무료 DNS가 CNAME을 막아 vercel 기본 도메인을 사용.
const PRIVACY_URL = 'https://team-page.vercel.app/#/privacy';
const TERMS_URL = 'https://team-page.vercel.app/#/terms';

// 외부 브라우저 이동 전 확인 안내 — 확인을 눌러야 링크를 연다 (GROMO-813)
function confirmOpenExternal(title: string, url: string) {
  Alert.alert(title, '외부 브라우저로 팀 사이트가 열립니다.\n이동하시겠습니까?', [
    { text: '취소', style: 'cancel' },
    {
      text: '확인',
      onPress: () => {
        Linking.openURL(url).catch(() =>
          Alert.alert('알림', '링크를 열 수 없어요. 잠시 후 다시 시도해주세요.'),
        );
      },
    },
  ]);
}

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
  // dev 미리보기 — 목표 달성 축하 모달 연출 확인용(__DEV__ 전용).
  const [modalPreview, setModalPreview] = useState<null | 'focus' | 'screentime'>(null);

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

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 프로필·설정 허브를 설명
  const profileRef = useRef<View | null>(null);
  const goalSectionRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: '전체 탭에서는 프로필과 앱의 모든 설정을 관리할 수 있어.',
      character: require('@/assets/character_hi.png'),
    },
    {
      text: '프로필을 탭하면 닉네임을 편집할 수 있어.',
      character: require('@/assets/character_happy.png'),
      anchor: profileRef,
    },
    {
      text: '준비 시험과 목표 시간은 여기서 바꿔.\n준비 시험을 바꾸면 추천 과목도 새로 받을 수 있어!',
      character: require('@/assets/character_study.png'),
      anchor: goalSectionRef,
    },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 헤더 — 탭하면 프로필 편집 */}
        <TouchableOpacity
          style={s.profile}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('SettingsProfileEdit')}
          ref={profileRef}
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
                  <Ionicons name="flame" size={10} color={T.flame} />
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

        {/* 섹션·순서(GROMO-848) — 자주 쓰는 행이 위(개인 목표), 1회성·드문 행이 아래(계정·문서·버전).
             아이콘 색 기준: 섹션마다 한 색 — 목표·집중=인디고, 알림·공개=초록, 계정·정보=중립 회색. */}
        <View ref={goalSectionRef} collapsable={false}>
          <SettingsSection title="목표 · 집중">
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
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
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
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
              label="스크린타임 권한"
              value={permission === null ? undefined : permissionLabel}
              valueColor={permission === 'approved' ? T.successInk : T.inkSub}
              onPress={() => navigation.navigate('SettingsScreenTimePermission')}
            />
            <SettingsRow
              icon="school-outline"
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
              label="준비 시험"
              value={category ?? '미설정'}
              onPress={() => navigation.navigate('SettingsOccupation')}
            />
          </SettingsSection>
        </View>

        <SettingsSection title="알림 · 공개">
          <SettingsRow
            icon="notifications-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
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
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label="계정 설정"
            sub="소셜 연동 · 로그아웃 · 회원 탈퇴"
            onPress={() => navigation.navigate('SettingsAccount')}
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label="개인정보 처리방침"
            onPress={() => confirmOpenExternal('개인정보 처리방침', PRIVACY_URL)}
          />
          <SettingsRow
            icon="reader-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label="서비스 이용약관"
            onPress={() => confirmOpenExternal('서비스 이용약관', TERMS_URL)}
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

        {/* 개발 전용 — 연출 디자인 확인용 임시 진입점(__DEV__ 빌드에만 노출).
             리그 결과 미리보기는 실데이터 연결(GROMO-831)로 제거 — 결과 화면은
             리그 탭 포커스 시 미확인 last-result가 있을 때만 뜬다 */}
        {__DEV__ && (
          <SettingsSection title="개발 (dev)">
            <SettingsRow
              icon="phone-portrait-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="스크린타임 목표 달성 모달 미리보기"
              sub="축하 + 연속 목표달성 연출"
              onPress={() => setModalPreview('screentime')}
            />
            <SettingsRow
              icon="timer-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="포커스 목표 달성 모달 미리보기"
              sub="축하 + 연속 목표달성 연출"
              onPress={() => setModalPreview('focus')}
            />
          </SettingsSection>
        )}
      </ScrollView>

      {/* dev 미리보기 — 목표 달성 축하 모달 연출 확인(__DEV__ 전용) */}
      {__DEV__ && (
        <>
          <ScreenTimeCelebrationModal
            visible={modalPreview === 'screentime'}
            streakDays={5}
            goalMinutes={180}
            onClose={() => setModalPreview(null)}
          />
          <GoalCelebrationModal
            visible={modalPreview === 'focus'}
            goalStreakDays={5}
            goalMinutes={120}
            onClose={() => setModalPreview(null)}
          />
        </>
      )}

      {/* 첫 진입 사용법 안내(GROMO-652) */}
      <TabGuideOverlay storageKey={STORAGE_KEYS.guideMenu} steps={guideSteps} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  flex1: { flex: 1 },
  body: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs },

  // 프로필 헤더
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  nameShrink: { flexShrink: 1 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  streakPillText: { ...T.text.caption, fontSize: 10, fontWeight: '700', color: T.accentDeep },
});
