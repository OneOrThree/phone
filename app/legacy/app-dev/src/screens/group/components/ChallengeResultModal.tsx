// 챌린지 결과 모달 — 정본 docs/prd/challenge/information-architecture.md §4.3 (N53 · GROMO-1279).
//
// 리그 승급화면(LeagueResultScreen)의 다크 radial 연출을 참조하되, 루트 스택 화면이 아니라
// **그룹 화면 위 RN Modal**이다 — 네비게이션 파일을 건드리지 않기 위한 계약(A3 스펙 2).
// 소스가 정산 완료 회차(/me/challenge-results)로 바뀌면서 이 모달은 **정산 결과 통지**다 —
// 인별 달성·손익까지 말한다(구 버전의 "금액 없음" 규칙은 정산 전 판정 모달 시절의 것).
// 무산(VOIDED)·환불(REFUNDED)·몰수(FORFEITED)도 결과다 — 돈이 움직였거나 움직이지 않기로
// 확정된 사건을 침묵하면 "내 코인 어디 갔지"가 된다(IA §4.3).
//
// 데이터 선택·1회 가드는 부모(GroupRoomScreen + challengeResult.ts)가 끝낸다 — 여기는 표현 전용.
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { T, withAlpha } from '@/constants/theme';
import { t } from '@/i18n';
import type { ChallengeResultCandidate, ChallengeResultMember } from '../challengeResult';
import {
  UNMEASURED,
  progressFraction,
  progressFractionA11y,
  unmeasuredA11y,
  windowFocusToleranceNotice,
} from './progressFormat';

// 내 결과별 헤드라인 — 리그 결과 화면의 caption/title 위계를 따른다.
// 그림은 시스템 이모지 대신 앱 공용 캐릭터 에셋 — OS·폰트 버전에 따라 모양이 흔들리지 않고
// 다른 결과 화면(리그 승급·집중 결과)과 화풍이 맞는다 (GROMO-1087).
// image는 스크린리더가 못 읽으므로 상태를 말로 옮긴 label을 함께 둔다.
// pending은 '집계 중'이 아니라 **미판정**이다 — 정산이 끝난 회차의 null은 백필되지 않는
// 영구 상태라(부분 정산 실패 등) '기다리면 나온다'로 읽히면 안 된다(LastBetResultSheet와 같은 결).
const HEADLINE = {
  achieved: {
    image: require('@/assets/character_happy.png'),
    imageLabelKey: 'group.challengeResultModal.achievedImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.achievedTitle',
  },
  failed: {
    image: require('@/assets/character_sensitive.png'),
    imageLabelKey: 'group.challengeResultModal.failedImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.failedTitle',
  },
  pending: {
    image: require('@/assets/character_study.png'),
    imageLabelKey: 'group.challengeResultModal.pendingImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.pendingTitle',
  },
  // 몰수(FORFEITED) — 서버가 이 상태를 붙이는 조건 **자체가** "달성자 0명"이다
  // (GroupBetPayoutCalculator:74 `winners.isEmpty() ? FORFEITED : SETTLED`, 전원 achieved=false).
  // 그래서 내 판정(myAchieved)이 아니라 **회차 상태 축**으로 말한다 — 아래 정산 문구
  // "아무도 달성하지 못해 적립금 N코인이 사라졌어요"와 **같은 사실**을 세워야 하기 때문이다.
  // 예전엔 헤드라인만 승패 축이라, myAchieved가 null(부분 정산 실패)인 몰수 회차에서
  // "결과를 판정하지 못했어요"(미판정)와 "아무도 달성하지 못해…"(확정)가 한 화면에 동시에
  // 떴다 — 미판정과 확정 서술이 서로를 부정한다(GROMO-1581).
  forfeited: {
    image: require('@/assets/character_sensitive.png'),
    imageLabelKey: 'group.challengeResultModal.forfeitedImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.forfeitedTitle',
  },
  // 무산·환불 — 승패가 아니라 돈이 제자리로 돌아간 결말. 승패 캐릭터를 세우면 거짓말이 된다.
  voided: {
    image: require('@/assets/character_study.png'),
    imageLabelKey: 'group.challengeResultModal.voidedImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.voidedTitle',
  },
  refunded: {
    image: require('@/assets/character_study.png'),
    imageLabelKey: 'group.challengeResultModal.refundedImage',
    caption: 'CHALLENGE RESULT',
    titleKey: 'group.challengeResultModal.refundedTitle',
  },
} as const;

// 'YYYY-MM-DD' → '8월 1일' (ChallengeCard.monthDay와 같은 표기 — 형식이 다르면 원문 유지).
function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m
    ? t('group.challengeResultModal.monthDay', { month: Number(m[2]), day: Number(m[3]) })
    : date;
}

// 판정 근거 한 조각 — 카드 진행 리스트와 **같은 조각**을 쓴다(progressFormat).
// 달성자에게도 분을 적는 것이 카드와 다른 점이자 이 화면의 본체다 — 카드는 '달성 ✓'로 갈음한다.
function minutesText(progressMinutes: number | null, goalMinutes: number | null): string {
  if (progressMinutes === null) return UNMEASURED;
  return progressFraction(progressMinutes, goalMinutes);
}

// 손익 표기 — payout은 '받은 금액'이라 그대로 쓰면 판돈 낸 사실이 지워진다 → 손익(payout−stake).
// null(미판정·부분 정산 실패)은 숫자를 지어내지 않고 '—'(LastBetResultSheet.deltaText와 같은 규칙).
export function resultDeltaText(payout: number | null, stake: number): string {
  if (payout === null) return '—';
  const delta = payout - stake;
  return `${delta > 0 ? '+' : ''}${delta}`;
}

// 정산 결말의 안내 한 줄 — 문구는 IA §4.3 표의 것이다(무산·환불도 결과다).
// SETTLED는 내 손익을 말한다(미판정이면 숫자를 지어내지 않고 생략 — null 반환).
export function settlementNotice(result: ChallengeResultCandidate): string | null {
  switch (result.status) {
    case 'FORFEITED':
      return t('group.challengeResultModal.forfeitedNotice', { pot: result.pot });
    case 'VOIDED':
      // 사유를 모르는 VOIDED(신설 사유 등)는 인원 부족이라고 지어내지 않는다 — 환불 사실만 말한다.
      // 인원 미달 값은 **문서와 서버가 갈려 있다** — LLD §2.1·IA §4.3 예시는 `SHORT_PARTICIPANTS`,
      // 서버 enum·V41 CHECK 는 `INSUFFICIENT_PARTICIPANTS`(policy N33 은 영문 이름을 정하지 않았다).
      // 한쪽만 보면 IA §4.3 이 규정한 카피가 **한 번도 뜨지 않고** 일반 폴백으로 강하한다 —
      // 둘 다 같은 문장으로 접는다(A3 `lastSettledView.VOID_REASON_ALIASES` 와 같은 처리).
      return t(
        result.voidReason === 'SHORT_PARTICIPANTS' ||
          result.voidReason === 'INSUFFICIENT_PARTICIPANTS'
          ? 'group.challengeResultModal.voidedShortNotice'
          : 'group.challengeResultModal.voidedNotice',
      );
    case 'REFUNDED':
      return t('group.challengeResultModal.refundedNotice');
    default: {
      if (result.myPayout === null) return null;
      const delta = result.myPayout - result.stake;
      return t('group.challengeResultModal.mySettlement', {
        delta: `${delta > 0 ? '+' : ''}${delta}`,
      });
    }
  }
}

// 헤드라인 선택 — **정산 문구(settlementNotice)와 같은 축**으로 갈린다. 두 함수가 나란히
// 같은 switch 모양인 것이 이 화면의 계약이다: 상태로 결말이 정해지는 회차(무산·환불·몰수)는
// 상태 축, 실제로 승패가 갈린 회차(SETTLED)만 내 판정(myAchieved) 축.
//
// 이 짝이 어긋나면 헤드라인과 정산 문구가 한 화면에서 서로를 부정한다 — GROMO-1581이 잡은
// 결함이 정확히 그것이었다(정산 문구엔 FORFEITED 분기가 있는데 헤드라인엔 없었다).
// 새 status를 추가할 때는 **두 함수를 함께** 고친다.
function pickHeadline(result: ChallengeResultCandidate): (typeof HEADLINE)[keyof typeof HEADLINE] {
  switch (result.status) {
    case 'VOIDED':
      return HEADLINE.voided;
    case 'REFUNDED':
      return HEADLINE.refunded;
    case 'FORFEITED':
      return HEADLINE.forfeited;
    default:
      return result.myAchieved === true
        ? HEADLINE.achieved
        : result.myAchieved === false
          ? HEADLINE.failed
          : HEADLINE.pending;
  }
}

// 창형 집중(FOCUS × TIME_WINDOW)만 판정에 5분 관용치가 있다 — 55/60분인 사람이 달성 명단에
// 서는 것이 모순으로 읽히지 않게 명단(숫자)보다 먼저 판정 규칙을 알린다(GROMO-1217).
// 조건·문구는 형제 화면과 **동일**하다: LastBetResultSheet(`:182-185`) ·
// challengeHistoryView.showToleranceNotice — GROMO-1207이 "결과 모달과 동일 문구·조건"으로 못박았다.
//
// '실측 분이 실제로 그려질 때만'이 세 번째 조건인 이유는 형제와 같다 — 숫자가 하나도 없으면
// 모순으로 읽힐 대상이 없다.
//
// ⚠️ `showRoster`는 **네 번째 조건이 아니라 세 번째 조건의 이 화면 몫**이다. 형제 시트는 명단을
// 항상 그려서 "실측 분 존재" 하나로 끝나지만, 이 화면은 무산·환불에서 **명단 자체를 그리지
// 않는다**(IA §4.3 — 판정이 아니라 환불이 사건의 본체다). 그 회차에도 서버는 `results`에
// 실측 분을 실어 보내므로, 상태를 안 보면 **화면에 숫자가 하나도 없는데 "5분 모자라도 달성"만
// 뜨는** 고지가 선다 — 형제 조건이 막으려던 바로 그 오신호다. 조건 수가 아니라 "그려지는 숫자가
// 있을 때만"이라는 규칙이 같은 것이다.
//
// 미션 메타가 없는 구서버 응답은 첫 두 조건에서 그냥 서지 않아 고지만 빠진다.
export function showToleranceNotice(
  result: ChallengeResultCandidate,
  showRoster: boolean,
): boolean {
  if (!showRoster) return false;
  return (
    result.missionType === 'TIME_WINDOW' &&
    result.missionCategory === 'FOCUS' &&
    [...result.achievers, ...result.failed, ...result.pending].some(
      (m) => typeof m.progressMinutes === 'number',
    )
  );
}

// iOS 유휴 넘침 단서(코덱스 리뷰 P2) — iOS 세로 인디케이터는 **스크롤 중에만** 보이고
// persistentScrollbar는 안드로이드 전용이라, 가만히 있는 사용자는 maxHeight에 잘린 명단이
// 더 있는지 알 수 없다. 레이아웃(가시 높이)과 컨텐츠 높이가 **둘 다 확정된 뒤 실제로 넘칠
// 때만** flashScrollIndicators로 한 번 깜빡여 단서를 준다 — 넘치지 않는데 깜빡이면 그게
// 오신호고, 한쪽 높이만 알고 판단하면 넘침을 놓치거나 지어낸다(onLayout·onContentSizeChange
// 도착 순서는 보장되지 않는다). 같은 컨텐츠 높이에는 한 번만 깜빡인다 — 레이아웃 재통지
// (회전 등)마다 반복되면 안내가 소음이 된다. 컨텐츠가 바뀌면(결과 큐 진행) 다시 한 번.
export function createListOverflowFlasher(flash: () => void): {
  onLayout: (height: number) => void;
  onContentSizeChange: (height: number) => void;
  reset: () => void;
} {
  let layoutHeight = 0; // 0 = 아직 미확정 — 미확정 상태에서는 판단하지 않는다
  let contentHeight = 0;
  let flashedForContentHeight = 0; // 마지막으로 깜빡인 컨텐츠 높이 — 중복 깜빡임 방지
  const maybeFlash = () => {
    if (
      layoutHeight > 0 &&
      contentHeight > layoutHeight &&
      flashedForContentHeight !== contentHeight
    ) {
      flashedForContentHeight = contentHeight;
      flash();
    }
  };
  return {
    onLayout: (height: number) => {
      layoutHeight = height;
      maybeFlash();
    },
    onContentSizeChange: (height: number) => {
      contentHeight = height;
      maybeFlash();
    },
    // 결과(result)가 갈릴 때 부른다 — 중복 가드만 풀고 **이미 아는 높이로 즉시 재판정**한다.
    // 결과 큐가 같은 모달 인스턴스로 진행되는데(GroupRoomScreen) 멤버·섹션 수가 같으면 렌더
    // 높이가 그대로라 onContentSizeChange가 다시 오지 않는다 — 높이를 지워 버리면 두 번째
    // 결과의 넘침 단서가 영영 안 나간다(코덱스 리뷰 P2 2차).
    reset: () => {
      flashedForContentHeight = 0;
      maybeFlash();
    },
  };
}

// 스크린리더는 행을 한 덩어리로 읽는다 — 이름·근거·손익이 따로 읽히면 누구 기록인지 잃는다.
function rowA11yLabel(m: ChallengeResultMember, goalMinutes: number | null, stake: number): string {
  const head =
    m.progressMinutes === null
      ? unmeasuredA11y(m.nickname)
      : progressFractionA11y(m.nickname, m.progressMinutes, goalMinutes);
  if (m.payout === null) return head;
  const delta = m.payout - stake;
  return delta >= 0
    ? t('group.challengeResultModal.rowA11yGain', { head, coins: delta })
    : t('group.challengeResultModal.rowA11yLoss', { head, coins: Math.abs(delta) });
}

// 명단 한 묶음(달성/미달성/미판정) — 비어 있으면 묶음째 그리지 않는다.
// 사람당 한 행이다(GROMO-1191) — 근거 분·손익을 붙이면서 한 줄 이어붙이기(join)를 걷어냈다.
function NameSection({
  title,
  icon,
  color,
  members,
  goalMinutes,
  stake,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  members: ChallengeResultMember[];
  goalMinutes: number | null;
  stake: number;
}) {
  if (members.length === 0) return null;
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Ionicons name={icon} size={15} color={color} />
        <Text style={[s.sectionTitle, { color }]}>
          {title} {members.length}
        </Text>
      </View>
      <View style={s.memberRows}>
        {members.map((m) => (
          <View
            key={m.userId}
            style={s.memberRow}
            accessible
            accessibilityLabel={rowA11yLabel(m, goalMinutes, stake)}
          >
            <Text style={s.memberName} numberOfLines={1}>
              {m.nickname}
            </Text>
            <Text style={s.memberMinutes}>{minutesText(m.progressMinutes, goalMinutes)}</Text>
            <Text style={s.memberDelta}>{resultDeltaText(m.payout, stake)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface ChallengeResultModalProps {
  result: ChallengeResultCandidate;
  onClose: () => void;
}

export default function ChallengeResultModal({ result, onClose }: ChallengeResultModalProps) {
  // 무산·환불·몰수는 승패 축이 아니다 — myAchieved로 갈리는 헤드라인은 SETTLED만 쓴다.
  const headline = pickHeadline(result);
  // 무산·환불은 명단을 그리지 않는다 — 판정이 아니라 환불이 사건의 본체다(IA §4.3 문구 표).
  const showRoster = result.status !== 'VOIDED' && result.status !== 'REFUNDED';
  const notice = settlementNotice(result);
  const toleranceNotice = showToleranceNotice(result, showRoster);

  // 명단 넘침의 유휴 단서 — ref 인스턴스의 flashScrollIndicators를 조건 로직(팩토리)에 넘긴다.
  const listRef = useRef<ScrollView>(null);
  const overflowFlasher = useRef(
    createListOverflowFlasher(() => listRef.current?.flashScrollIndicators()),
  ).current;

  // 결과 키가 바뀌면(큐 진행) 중복 가드를 리셋 — 높이가 같아 사이즈 이벤트가 안 와도
  // 새 결과의 넘침 단서가 다시 나간다. 첫 마운트에는 높이 미확정이라 no-op이다.
  useEffect(() => {
    overflowFlasher.reset();
  }, [result.sessionId, overflowFlasher]);

  // 등장 연출 — 카드 팝인 하나만 쓴다(리그 화면의 다단계 연출은 풀스크린 화면 몫).
  // 결과가 넘어가며(큐) 같은 모달이 내용만 갈릴 때도 다시 팝 되도록 결과 키(세션)에 묶는다.
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    }).start();
  }, [result.sessionId, pop]);

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.root} testID="group.challengeResult">
        {/* 리그 결과와 같은 다크 radial — expo-linear-gradient엔 radial이 없어 svg로 */}
        <Svg style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="challengeResultBg" cx="50%" cy="30%" rx="80%" ry="55%">
              <Stop offset="0" stopColor={T.night.top} />
              <Stop offset="1" stopColor={T.night.bottom} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#challengeResultBg)" />
        </Svg>

        <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
          <Animated.View
            style={[
              s.body,
              {
                opacity: pop,
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                ],
              },
            ]}
          >
            <Text style={s.caption}>{headline.caption}</Text>
            <Text style={s.title}>{t(headline.titleKey)}</Text>

            {/* 캐릭터 + 글로우 — 리그의 뱃지 자리를 대신한다.
                에셋마다 가로세로비가 달라 contain으로 넣는다(원 안에 들어가는 쪽이 기준) */}
            <View style={s.glow}>
              <Image
                source={headline.image}
                style={s.character}
                resizeMode="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel={t(headline.imageLabelKey)}
                testID="group.challengeResult.character"
              />
            </View>

            {/* 어느 그룹의 어느 날 결과인가 — 큐가 그룹 무관이라(탈퇴자 포함) 그룹 이름을 직접
                말한다. 문구에 '회차'를 쓰지 않는다(IA §6.3 — 날짜가 이미 그 하루를 표현한다). */}
            <Text style={s.label}>{result.groupName}</Text>
            <Text style={s.date}>
              {t('group.challengeResultModal.dateResult', { date: monthDay(result.date) })}
            </Text>

            {/* 창형 집중의 5분 관용치 고지 — 명단(숫자)보다 **먼저** 세운다. 명단 안(스크롤)에
                넣으면 잘려서 안 보이는 사용자가 55/60분을 달성 옆에서 모순으로 읽는다.
                형제 화면(LastBetResultSheet·챌린지 내역)의 자리·문구·조건과 같다(GROMO-1207). */}
            {toleranceNotice && (
              <Text style={s.toleranceNotice} testID="group.challengeResult.toleranceNotice">
                {windowFocusToleranceNotice()}
              </Text>
            )}

            {/* 명단 — 3상(달성·미달성·미판정)을 뭉개지 않고, 손익까지 함께 적는다(정산 통지).
                넘침을 숨기지 않도록 인디케이터를 켜고(iOS는 다크 배경이라 white, Android는 잠깐
                떴다 사라지지 않게 persistent), iOS는 유휴 상태에선 인디케이터가 안 보여 넘침
                확정 시 한 번 깜빡인다(위 팩토리). */}
            {showRoster && (
              <ScrollView
                ref={listRef}
                style={s.lists}
                showsVerticalScrollIndicator
                indicatorStyle="white"
                persistentScrollbar
                onLayout={(e) => overflowFlasher.onLayout(e.nativeEvent.layout.height)}
                onContentSizeChange={(_w, h) => overflowFlasher.onContentSizeChange(h)}
                testID="group.challengeResult.lists"
              >
                <NameSection
                  title={t('group.challengeResultModal.sectionAchieved')}
                  icon="checkmark-circle"
                  color={T.night.green}
                  members={result.achievers}
                  goalMinutes={result.goalMinutes}
                  stake={result.stake}
                />
                <NameSection
                  title={t('group.challengeResultModal.sectionFailed')}
                  icon="close-circle"
                  color={T.night.muted}
                  members={result.failed}
                  goalMinutes={result.goalMinutes}
                  stake={result.stake}
                />
                <NameSection
                  title={t('group.challengeResultModal.sectionPending')}
                  icon="help-circle-outline"
                  color={T.night.gold}
                  members={result.pending}
                  goalMinutes={result.goalMinutes}
                  stake={result.stake}
                />
              </ScrollView>
            )}

            {/* 정산 결말 한 줄 — 몰수·무산·환불 문구 또는 내 손익(IA §4.3). */}
            {notice !== null && (
              <Text style={s.betHint} testID="group.challengeResult.notice">
                {notice}
              </Text>
            )}
          </Animated.View>

          <TouchableOpacity
            style={s.cta}
            activeOpacity={0.85}
            onPress={onClose}
            testID="group.challengeResult.close"
          >
            <Text style={s.ctaText}>{t('common.confirm')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.night.bottom },
  safe: { flex: 1, paddingHorizontal: T.space.xxl },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  caption: {
    ...T.text.label,
    fontWeight: '700',
    color: T.accentLight,
    letterSpacing: 2,
    marginBottom: T.space.sm,
  },
  title: { ...T.text.title, color: T.night.cream, marginBottom: T.space.xl },

  glow: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.night.gold, 0.16),
    marginBottom: T.space.xl,
    shadowColor: T.night.gold,
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  // 글로우 원(132) 안쪽 여백을 남기는 크기 — 캐릭터가 원 밖으로 삐져나오지 않게
  character: { width: 108, height: 108 },

  label: { ...T.text.subtitle, color: T.night.cream, textAlign: 'center' },
  date: { ...T.text.caption, color: T.night.muted, marginTop: 2, marginBottom: T.space.lg },

  // 판정 규칙 고지 — 명단 직전 고정 한 줄(LastBetResultSheet.toleranceNotice와 같은 역할).
  // 이 화면은 다크 배경이라 색만 야간 팔레트의 보조 톤(night.muted)을 쓴다.
  toleranceNotice: {
    ...T.text.caption,
    color: T.night.muted,
    textAlign: 'center',
    marginBottom: T.space.sm,
  },

  lists: { alignSelf: 'stretch', flexGrow: 0, maxHeight: 220 },
  section: { alignItems: 'center', marginBottom: T.space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  sectionTitle: { ...T.text.caption, fontWeight: '700' },

  // 이름 | 근거 분 | 손익 — 카드 진행 리스트(progressRow)와 같은 배치 결: 이름 왼쪽, 숫자 오른쪽.
  // 행마다 가운데 정렬하면 이름 길이만큼 숫자가 좌우로 흔들려 세로로 훑을 수 없다(PR #493 리뷰).
  // 폭은 화면 전체가 아니라 읽기 좋은 상한까지만 벌리고, 그 덩어리를 가운데 둔다.
  memberRows: { alignSelf: 'center', width: '100%', maxWidth: 280 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: T.space.sm,
    marginTop: 4,
  },
  memberName: { ...T.text.body, color: T.night.cream, flexShrink: 1, flexGrow: 1 },
  memberMinutes: {
    ...T.text.caption,
    color: T.night.muted,
    fontVariant: ['tabular-nums'],
  },
  // 손익 — LastBetResultSheet.delta와 같은 규칙(±는 텍스트에 있다). 다크 배경이라 색은 크림 톤.
  memberDelta: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.night.cream,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'right',
  },

  betHint: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.accentLight,
    textAlign: 'center',
    marginTop: T.space.sm,
  },

  cta: {
    minHeight: 56,
    paddingVertical: T.space.md,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.xxl,
  },
  ctaText: { ...T.text.body, fontWeight: '700', color: T.white },
});
