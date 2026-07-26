import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, { type UsageBucketDebugInfo } from '@/services/ScreenTimeModule';
import { getStreak } from '@/services/statsApi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@/store/UserContext';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
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

// epoch 초 → "M/D HH:mm:ss" (dev 패널 등록 시각 표기용)
function debugTimeLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// dev 전용 — 스크린타임 버킷 측정 상태 실시간 패널(GROMO-931 15분 눈금 확인용).
// App Group 기록(눈금·베이스·등록 시각)과 로컬 마커·업로드 상태를 3초마다 다시 읽는다.
// 열려 있는 동안만 폴링 — 닫으면 언마운트되며 타이머도 정리된다.
function BucketDebugPanel() {
  const { userId } = useUser();
  const [info, setInfo] = useState<UsageBucketDebugInfo | null>(null);
  const [marker, setMarker] = useState<string | null>(null);
  const [syncLabel, setSyncLabel] = useState('없음');
  // 강제 재등록 결과 표시 — Xcode 재설치가 모니터를 끊었을 때 재선택 없이 되살리는 용도.
  const [reregLabel, setReregLabel] = useState<string | null>(null);

  const forceReregister = async () => {
    setReregLabel('재등록 중…');
    const ok = await registerUsageBucketMonitoring(userId).catch(() => false);
    setReregLabel(ok ? '재등록 성공 — 등록 시각 갱신 확인' : '실패 — 권한·측정 대상 선택 확인');
  };

  // GROMO-942 스파이크 — arm 후 강제 재등록으로 익스텐션 intervalDidStart를 즉시 유발.
  // 결과는 이벤트 로그로 관찰(spike 등록 성공/실패 → 대상 앱 1~3분 사용 시 spike 눈금 발화).
  const runSpike = async (mode: 'separate' | 'self') => {
    setReregLabel('스파이크 arm 중…');
    const armed = await ScreenTimeModule.armUsageBucketSpike(mode).catch(() => false);
    if (!armed) {
      setReregLabel('스파이크 arm 실패');
      return;
    }
    const ok = await registerUsageBucketMonitoring(userId).catch(() => false);
    setReregLabel(
      ok ? '스파이크 발사 — 이벤트 로그에서 spike 줄 확인' : '재등록 실패 — 권한·측정 대상 확인',
    );
  };

  // 자정 실측 — arm만 하고 재등록하지 않는다. 플래그가 남아 있다가 진짜 자정 콜백에서 실험 실행.
  const armMidnightSpike = async () => {
    const armed = await ScreenTimeModule.armUsageBucketSpike('separate').catch(() => false);
    setReregLabel(
      armed ? '자정 실측 arm — 내일 아침 로그에서 spike 줄 확인' : '자정 실측 arm 실패',
    );
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const i = await ScreenTimeModule.getUsageBucketDebugInfo();
        const m = await AsyncStorage.getItem(STORAGE_KEYS.screentimeBucketMonitorMaxMinutes);
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState);
        if (cancelled) return;
        setInfo(i);
        setMarker(m);
        if (raw) {
          const p = JSON.parse(raw) as { date: string; minutes: number };
          setSyncLabel(`${p.minutes}분 @ ${p.date}`);
        } else {
          setSyncLabel('없음');
        }
      } catch {
        // dev 패널 — 조회 실패는 이전 표시 유지
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const rows: [string, string][] = [
    ['등록 마커', marker ?? '없음 (다음 실행 때 재등록)'],
    ['등록 시각', info && info.registeredAt > 0 ? debugTimeLabel(info.registeredAt) : '기록 없음'],
    ['오늘 눈금', info ? `${info.bucketMinutes}분 (${info.bucketDate || '—'})` : '—'],
    ['재등록 베이스', info ? `${info.baseMinutes}분 (${info.baseDate || '—'})` : '—'],
    ['어제 보존', info ? `${info.prevBucketMinutes}분 (${info.prevBucketDate || '—'})` : '—'],
    ['마지막 업로드', syncLabel],
  ];
  // 이벤트 로그 — 익스텐션·등록이 남긴 최근 기록(최신순 12줄만 표시)
  const logLines = (info?.log ?? []).slice(-12).reverse();
  return (
    <View style={s.debugPanel}>
      {rows.map(([k, v]) => (
        <View key={k} style={s.debugRow}>
          <Text style={s.debugKey}>{k}</Text>
          <Text style={s.debugVal}>{v}</Text>
        </View>
      ))}
      {logLines.length > 0 ? (
        <View style={s.debugLogBox}>
          <Text style={s.debugKey}>이벤트 로그 (최신순)</Text>
          {logLines.map((line, i) => (
            <Text key={`${i}-${line}`} style={s.debugLogLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <TouchableOpacity style={s.debugBtn} onPress={forceReregister} activeOpacity={0.7}>
        <Text style={s.debugBtnText}>버킷 모니터 강제 재등록</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.debugBtn} onPress={() => runSpike('separate')} activeOpacity={0.7}>
        <Text style={s.debugBtnText}>942 실험A — 콜백 내 별도 활동 등록</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.debugBtn} onPress={() => runSpike('self')} activeOpacity={0.7}>
        <Text style={s.debugBtnText}>942 실험B — 콜백 내 자기 재등록</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.debugBtn} onPress={armMidnightSpike} activeOpacity={0.7}>
        <Text style={s.debugBtnText}>942 자정 실측 arm — 재등록 없이 대기</Text>
      </TouchableOpacity>
      {reregLabel ? <Text style={s.debugHint}>{reregLabel}</Text> : null}
      <Text style={s.debugHint}>
        3초마다 자동 갱신 — 측정 대상 앱을 쓰면 &apos;오늘 눈금&apos;이 15분 단위로 올라가야
        정상이에요. Xcode 재설치 후 눈금이 멈추면 위 버튼으로 재등록.
      </Text>
    </View>
  );
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
  // dev 스크린타임 측정 디버그 패널 열림 여부(__DEV__ 전용, GROMO-931)
  const [bucketDebugOpen, setBucketDebugOpen] = useState(false);

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
              label="스크린타임 관리"
              sub="권한 · 측정 대상 앱"
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
            <SettingsRow
              icon="stats-chart-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="스크린타임 측정 디버그"
              sub="버킷 기록·등록 상태 실시간 확인"
              onPress={() => setBucketDebugOpen((v) => !v)}
            />
            {bucketDebugOpen ? <BucketDebugPanel /> : null}
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

  // dev 스크린타임 측정 디버그 패널(GROMO-931)
  debugPanel: { paddingVertical: T.space.md, gap: 6 },
  debugRow: { flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md },
  debugKey: { ...T.text.caption, color: T.inkMuted },
  debugVal: { ...T.text.caption, color: T.ink, flexShrink: 1, textAlign: 'right' },
  debugHint: { ...T.text.caption, color: T.inkFaint, marginTop: 4 },
  debugBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: T.space.md,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.accentAltBg,
  },
  debugBtnText: { ...T.text.caption, fontWeight: '700', color: T.accentAlt },
  debugLogBox: { marginTop: 6, gap: 2 },
  debugLogLine: { ...T.text.caption, fontSize: 10, color: T.inkSub },
});
