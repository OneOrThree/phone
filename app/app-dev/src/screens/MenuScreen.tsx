import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, { type UsageBucketDebugInfo } from '@/services/ScreenTimeModule';
import { supportsAppSelection, supportsFocusShield } from '@/services/screenTimeCapabilities';
import { getStreak } from '@/services/statsApi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@/store/UserContext';
import { useCharacter } from '@/store/CharacterContext';
import { useCoins, useRefreshCoinsOnFocus } from '@/store/CoinContext';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import { STORAGE_KEYS } from '@/types/storage';
import { CharacterImage } from '@/components/character/CharacterImage';
import { GoalCelebrationModal } from '@/components/GoalCelebrationModal';
import { ScreenTimeCelebrationModal } from '@/components/ScreenTimeCelebrationModal';
import ChallengeResultModal from '@/screens/group/components/ChallengeResultModal';
import type { ChallengeResultCandidate } from '@/screens/group/challengeResult';
import { yesterdayStr } from '@/utils/localDate';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { CURRENCY } from '@/constants/currency';
import { logCurrencyChipTapped } from '@/services/analyticsEvents';

// v2 '전체' 탭 = 설정 허브(SET·앱 설정). 프로필 헤더 + 시안 행 그룹 + 광고 배너.
// 실제 동작(목표 편집·허용앱·스크린타임·로그아웃 등)은 각 하위 화면(settings/*)이 담당하고,
// 허브는 진입점만 제공한다. (기존 MenuScreen 로직은 하위 화면으로 이전·재사용)

// 초 → "N시간"/"N시간 M분" (행 sub 요약용)
function hLabel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return t('menu.duration.hourMinute', { h, m });
  if (h) return t('menu.duration.hour', { h });
  return t('menu.duration.minute', { m });
}

const APP_VERSION = Constants.expoConfig?.version ?? '—';

// GROMO-813: 법적 문서는 팀 사이트로 연결. 무료 DNS가 CNAME을 막아 vercel 기본 도메인을 사용.
const PRIVACY_URL = 'https://team-page.vercel.app/#/privacy';
const TERMS_URL = 'https://team-page.vercel.app/#/terms';

// 외부 브라우저 이동 전 확인 안내 — 확인을 눌러야 링크를 연다 (GROMO-813)
function confirmOpenExternal(title: string, url: string) {
  Alert.alert(title, t('menu.openExternalMessage'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('common.confirm'),
      onPress: () => {
        Linking.openURL(url).catch(() =>
          Alert.alert(t('menu.noticeTitle'), t('menu.linkOpenFailed')),
        );
      },
    },
  ]);
}

// dev 미리보기 — 챌린지 결과 모달(A3)의 내 결과 3분기 연출을 실데이터 없이 확인한다.
// 결과 모달은 '종료된 챌린지 + 미노출 가드'가 동시에 성립할 때만 뜨는 화면이라, 그냥 두면
// 하루에 한 번·특정 시각에만 볼 수 있어 디자인 확인이 사실상 불가능하다(리그 결과 미리보기를
// 뒀던 이유와 같다).
// ⚠️ 미리보기는 **모달 컴포넌트만** 띄운다 — 1회 노출 가드(markChallengeResultSeen)와 GA4
//    발행은 GroupRoomScreen이 쥐고 있어, 여기서 아무리 열어도 실사용 가드·지표를 오염시키지 않는다.
type ChallengeResultPreviewKind = 'challengeAchieved' | 'challengeFailed' | 'challengePending';

function challengeResultPreview(kind: ChallengeResultPreviewKind): ChallengeResultCandidate {
  // 날짜는 실제 노출과 같은 '어제' — 모달의 'M/D 결과' 표기가 실전과 같은 모양으로 보인다.
  // dev fixture라 로컬 유지 — 서버로 나가지 않는 미리보기 값(GROMO-1236 분류 C).
  // v2(GROMO-1279): 소스가 정산 완료 회차(/me/challenge-results)라 손익까지 함께 보인다.
  const base = {
    sessionId: `preview-${kind}`,
    challengeId: `preview-${kind}`,
    groupId: 'preview-group',
    groupName: '아침 6시 집중방',
    date: yesterdayStr(),
    status: 'SETTLED' as const,
    voidReason: null,
    stake: 30,
    pot: 120,
    goalMinutes: 60,
    memberCount: 4,
  };
  if (kind === 'challengeAchieved') {
    return {
      ...base,
      // 목표를 넘긴 정도를 사람마다 다르게 둔다 — 근거 분(GROMO-1191)이 붙는 자리라
      // 전부 같은 값이면 표기가 제대로 보이는지 알 수 없다.
      achievers: [
        { userId: 'u-me', nickname: '나', progressMinutes: 72, payout: 40 },
        { userId: 'u-subin', nickname: '수빈', progressMinutes: 60, payout: 40 },
        { userId: 'u-minji', nickname: '민지', progressMinutes: 145, payout: 40 },
      ],
      failed: [{ userId: 'u-jihun', nickname: '지훈', progressMinutes: 23, payout: 0 }],
      pending: [],
      myAchieved: true,
      myPayout: 40,
    };
  }
  if (kind === 'challengeFailed') {
    return {
      ...base,
      achievers: [
        { userId: 'u-subin', nickname: '수빈', progressMinutes: 61, payout: 60 },
        { userId: 'u-minji', nickname: '민지', progressMinutes: 88, payout: 60 },
      ],
      // 0분(아예 안 함)과 아깝게 놓친 경우를 같이 둔다 — 둘 다 미달성이지만 읽히는 맛이 다르다.
      failed: [
        { userId: 'u-me', nickname: '나', progressMinutes: 59, payout: 0 },
        { userId: 'u-jihun', nickname: '지훈', progressMinutes: 0, payout: 0 },
      ],
      pending: [],
      myAchieved: false,
      myPayout: 0,
    };
  }
  // 미판정 — 스크린타임은 클라 보고가 있어야 판정돼 3상이 실제로 섞인다.
  // 미보고는 progressMinutes가 null이라 '—'로 비고, 0분(진짜 안 씀)과 칸이 갈린다.
  return {
    ...base,
    goalMinutes: 120,
    achievers: [{ userId: 'u-subin', nickname: '수빈', progressMinutes: 34, payout: 60 }],
    failed: [{ userId: 'u-jihun', nickname: '지훈', progressMinutes: 210, payout: 0 }],
    pending: [
      { userId: 'u-me', nickname: '나', progressMinutes: null, payout: null },
      { userId: 'u-minji', nickname: '민지', progressMinutes: null, payout: null },
    ],
    myAchieved: null,
    myPayout: null,
  };
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
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  const insets = useSafeAreaInsets();
  // 시간조각(재화) 잔액 — 프로필 아래 행. 포커스 시 서버 잔액 재조회(내기 차감·정산 반영).
  const { coins } = useCoins();
  useRefreshCoinsOnFocus();

  // 허브 행 우측 요약값 — 준비 시험 / 허용앱 개수 / 스크린타임 권한 상태.
  const [category, setCategory] = useState<string | null>(null); // 준비 시험(focusCategory)
  const [allowedApps, setAllowedApps] = useState<number | null>(null);
  const [permission, setPermission] = useState<'approved' | 'denied' | 'notDetermined' | null>(
    null,
  );
  // 연속 공부 일수(하루 10분 스트릭, GROMO-630) — 0이면 pill 생략.
  const [streakDays, setStreakDays] = useState(0);
  // dev 미리보기 — 목표 달성 축하 모달 + 챌린지 결과 모달 연출 확인용(__DEV__ 전용).
  const [modalPreview, setModalPreview] = useState<
    null | 'focus' | 'screentime' | ChallengeResultPreviewKind
  >(null);
  // dev 스크린타임 측정 디버그 패널 열림 여부(__DEV__ 전용, GROMO-931)
  const [bucketDebugOpen, setBucketDebugOpen] = useState(false);

  // 화면 재진입마다 최신값 반영(하위 화면에서 바꾸고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // 허용앱 행을 안 그리는 플랫폼에선 조회도 하지 않는다 — 어차피 null이 와서 '허용앱 없음'
      // 으로 보이는데, 그 값이 쓰이지 않더라도 매 진입마다 헛도는 왕복이 남는다.
      if (supportsFocusShield()) {
        ScreenTimeModule.getAllowedSelectionCounts()
          .then((c) => !cancelled && setAllowedApps(c?.applications ?? 0))
          .catch(() => !cancelled && setAllowedApps(0));
      }
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
    permission === 'approved'
      ? t('menu.permission.approved')
      : permission === 'denied'
        ? t('menu.permission.denied')
        : t('menu.permission.notDetermined');

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 프로필·설정 허브를 설명
  const profileRef = useRef<View | null>(null);
  const goalSectionRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: t('menu.guide.intro'),
      character: require('@/assets/character_hi.png'),
    },
    {
      text: t('menu.guide.profile'),
      character: require('@/assets/character_happy.png'),
      anchor: profileRef,
    },
    {
      text: t('menu.guide.goalSection'),
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
            <CharacterImage size={44} sourceUri={activeSource ?? undefined} />
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
                  <Text style={s.streakPillText}>
                    {t('menu.profile.streak', { count: streakDays })}
                  </Text>
                </View>
              )}
            </View>
            <Text style={s.profileSub} numberOfLines={1}>
              {category ? t('menu.profile.preparing', { category }) : t('menu.profile.edit')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={T.inkMuted} />
        </TouchableOpacity>

        {/* 시간조각(재화) 잔액 — 탭하면 거래 내역(CurrencyHistory). 포커스 시 잔액 refresh.
            미로드 시에도 '0'으로 둔다(GROMO-1073) — 지갑은 가입 시 함께 생겨 신규 유저의
            정답도 0이고, 이 행은 잔액으로 무엇도 막지 않는다(잠금 판정은 BetSheet 몫). */}
        <SettingsSection>
          <SettingsRow
            icon="hourglass-outline"
            iconColor={T.accentDeep}
            iconBg={T.accentBg}
            label={CURRENCY.label}
            value={t('menu.currencyValue', { amount: coins.toLocaleString() })}
            onPress={() => {
              logCurrencyChipTapped({ location: 'menu' });
              navigation.navigate('CurrencyHistory', { entry: 'menu_chip' });
            }}
          />
        </SettingsSection>

        {/* 섹션·순서(GROMO-848) — 자주 쓰는 행이 위(개인 목표), 1회성·드문 행이 아래(계정·문서·버전).
             아이콘 색 기준: 섹션마다 한 색 — 목표·집중=인디고, 알림·공개=초록, 계정·정보=중립 회색. */}
        <View ref={goalSectionRef} collapsable={false}>
          <SettingsSection title={t('menu.section.goalFocus')}>
            <SettingsRow
              icon="flag-outline"
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
              label={t('menu.goal.personalGoal')}
              sub={t('menu.goal.personalGoalSub', {
                focus: hLabel(goalSeconds),
                screenTime: hLabel(screenTimeGoalSeconds),
              })}
              onPress={() => navigation.navigate('SettingsGoals')}
            />
            {/* 허용앱은 집중 실드(차단)의 예외 목록이라 실드가 없는 플랫폼에선 의미가 없다.
                행을 남기면 화면은 열리지만 피커가 안 뜨고, 게다가 '집중 중 모든 앱이 잠겨요'로
                안 잠기는 걸 잠긴다고 안내하게 된다(GROMO-1592). */}
            {supportsFocusShield() ? (
              <SettingsRow
                icon="lock-open-outline"
                iconColor={T.accentDeep}
                iconBg={T.accentBg}
                label={t('menu.goal.allowedApps')}
                sub={
                  allowedApps === null
                    ? t('menu.goal.allowedAppsHint')
                    : allowedApps > 0
                      ? t('menu.goal.allowedAppsCount', { count: allowedApps })
                      : t('menu.goal.allowedAppsNone')
                }
                onPress={() => navigation.navigate('SettingsAllowedApps')}
              />
            ) : null}
            <SettingsRow
              icon="phone-portrait-outline"
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
              label={t('menu.goal.screenTime')}
              // 부제는 하위 화면에 실제로 있는 것만 적는다 — 측정 대상 앱 설정은 피커가 없는
              // 플랫폼에서 숨기므로, 부제만 남으면 없는 항목을 찾아 들어가게 된다(GROMO-1592).
              sub={
                supportsAppSelection()
                  ? t('menu.goal.screenTimeSubSelection')
                  : t('menu.goal.screenTimeSub')
              }
              value={permission === null ? undefined : permissionLabel}
              valueColor={permission === 'approved' ? T.successInk : T.inkSub}
              onPress={() => navigation.navigate('SettingsScreenTimePermission')}
            />
            <SettingsRow
              icon="school-outline"
              iconColor={T.accentDeep}
              iconBg={T.accentBg}
              label={t('menu.goal.occupation')}
              value={category ?? t('menu.goal.occupationUnset')}
              onPress={() => navigation.navigate('SettingsOccupation')}
            />
          </SettingsSection>
        </View>

        {/* '캐릭터' 섹션(사진에서 캐릭터 만들기)은 제거(GROMO-1076) — 진입점을 홈 '캐릭터 변경'
             화면으로 일원화한다. CharacterCreate 라우트 자체는 그 화면이 계속 쓰므로 유지. */}

        <SettingsSection title={t('menu.section.notificationPrivacy')}>
          <SettingsRow
            icon="notifications-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label={t('menu.notification.settings')}
            sub={t('menu.notification.settingsSub')}
            onPress={() => navigation.navigate('SettingsNotification')}
          />
          <SettingsRow
            icon="eye-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label={t('menu.notification.statVisibility')}
            onPress={() => navigation.navigate('SettingsStatVisibility')}
          />
        </SettingsSection>

        <SettingsSection title={t('menu.section.accountInfo')}>
          <SettingsRow
            icon="person-circle-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('menu.account.settings')}
            sub={t('menu.account.settingsSub')}
            onPress={() => navigation.navigate('SettingsAccount')}
          />
          {/* 앱의 유일한 문의 창구다(docs/prd/inquiry/information-architecture.md §5).
               다른 진입점이 생기면 inquiry_screen_viewed 의 entry_point 를 함께 넓혀야 한다. */}
          <SettingsRow
            icon="chatbubble-ellipses-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('menu.account.inquiry')}
            sub={t('menu.account.inquirySub')}
            onPress={() => navigation.navigate('SettingsInquiry')}
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('menu.account.privacy')}
            onPress={() => confirmOpenExternal(t('menu.account.privacy'), PRIVACY_URL)}
          />
          <SettingsRow
            icon="reader-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('menu.account.terms')}
            onPress={() => confirmOpenExternal(t('menu.account.terms'), TERMS_URL)}
          />
          <SettingsRow
            icon="information-circle-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('menu.account.version')}
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
              icon="trophy-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="챌린지 결과 모달 — 달성"
              sub="그룹 챌린지 결과 발표 연출(내 결과: 달성)"
              onPress={() => setModalPreview('challengeAchieved')}
            />
            <SettingsRow
              icon="sad-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="챌린지 결과 모달 — 미달성"
              sub="같은 연출의 미달성 분기"
              onPress={() => setModalPreview('challengeFailed')}
            />
            <SettingsRow
              icon="hourglass-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="챌린지 결과 모달 — 미판정"
              sub="스크린타임 미보고 3상(달성·미달성·집계 중) 혼재"
              onPress={() => setModalPreview('challengePending')}
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
            rewardCoins={30}
            onClose={() => setModalPreview(null)}
          />
          <GoalCelebrationModal
            visible={modalPreview === 'focus'}
            goalStreakDays={5}
            goalMinutes={120}
            rewardCoins={30}
            onClose={() => setModalPreview(null)}
          />
          {/* 챌린지 결과 모달은 visible prop 없이 조건부 렌더 방식이다(그룹방과 같은 사용법) */}
          {modalPreview !== null && modalPreview !== 'focus' && modalPreview !== 'screentime' && (
            <ChallengeResultModal
              result={challengeResultPreview(modalPreview)}
              onClose={() => setModalPreview(null)}
            />
          )}
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
