// 챌린지 결과 모달 — 계약 contract.md §2 "앱 UI 계약 (A3)" · 확정 정책 "결과 노출" 3행.
//
// 리그 승급화면(LeagueResultScreen)의 다크 radial 연출을 참조하되, 루트 스택 화면이 아니라
// **그룹 화면 위 RN Modal**이다 — 네비게이션 파일을 건드리지 않기 위한 계약(A3 스펙 2).
// 내용은 승패만 말한다: 달성/미달성/집계 중 명단. **금액은 어디에도 쓰지 않는다** —
// 정산(코인 이동)은 서버 배치 몫이고, 모달 시점엔 아직 지급 전이라 숫자를 보여줄 수 없다.
// 내기가 걸려 있던 결과에만 "정산 후 알림" 안내 한 줄을 세운다.
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
import type { ChallengeResultCandidate, ChallengeResultMember } from '../challengeResult';
import {
  UNMEASURED,
  progressFraction,
  progressFractionA11y,
  unmeasuredA11y,
} from './progressFormat';

// 내 결과별 헤드라인 — 리그 결과 화면의 caption/title 위계를 따른다.
// 내 결과가 아직 없으면(집계 중·명단에 없음) 중립 문구로 떨어뜨린다.
// 그림은 시스템 이모지 대신 앱 공용 캐릭터 에셋 — OS·폰트 버전에 따라 모양이 흔들리지 않고
// 다른 결과 화면(리그 승급·집중 결과)과 화풍이 맞는다 (GROMO-1087).
// image는 스크린리더가 못 읽으므로 상태를 말로 옮긴 label을 함께 둔다.
const HEADLINE = {
  achieved: {
    image: require('@/assets/character_happy.png'),
    imageLabel: '목표를 달성해 기뻐하는 캐릭터',
    caption: 'CHALLENGE RESULT',
    title: '목표를 달성했어요!',
  },
  failed: {
    image: require('@/assets/character_sensitive.png'),
    imageLabel: '목표를 놓쳐 아쉬워하는 캐릭터',
    caption: 'CHALLENGE RESULT',
    title: '아쉽게 놓쳤어요',
  },
  pending: {
    image: require('@/assets/character_study.png'),
    imageLabel: '결과를 집계하는 동안 공부하는 캐릭터',
    caption: 'CHALLENGE RESULT',
    title: '결과 집계 중이에요',
  },
} as const;

// 'YYYY-MM-DD' → '8월 1일' (ChallengeCard.monthDay와 같은 표기 — 형식이 다르면 원문 유지).
function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : date;
}

// 판정 근거 한 조각 — 카드 진행 리스트와 **같은 조각**을 쓴다(progressFormat).
// 달성자에게도 분을 적는 것이 카드와 다른 점이자 이 화면의 본체다 — 카드는 '달성 ✓'로 갈음한다.
function minutesText(progressMinutes: number | null, goalMinutes: number | null): string {
  if (progressMinutes === null) return UNMEASURED;
  return progressFraction(progressMinutes, goalMinutes);
}

// 스크린리더는 행을 한 덩어리로 읽는다 — 이름과 근거가 따로 읽히면 누구 기록인지 잃는다.
function minutesA11yLabel(
  nickname: string,
  progressMinutes: number | null,
  goalMinutes: number | null,
): string {
  if (progressMinutes === null) return unmeasuredA11y(nickname);
  return progressFractionA11y(nickname, progressMinutes, goalMinutes);
}

// 명단 한 묶음(달성/미달성/집계 중) — 비어 있으면 묶음째 그리지 않는다.
// 사람당 한 행이다(GROMO-1191) — 근거 분을 붙이면서 한 줄 이어붙이기(join)를 걷어냈다.
function NameSection({
  title,
  icon,
  color,
  members,
  goalMinutes,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  members: ChallengeResultMember[];
  goalMinutes: number | null;
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
            accessibilityLabel={minutesA11yLabel(m.nickname, m.progressMinutes, goalMinutes)}
          >
            <Text style={s.memberName} numberOfLines={1}>
              {m.nickname}
            </Text>
            <Text style={s.memberMinutes}>{minutesText(m.progressMinutes, goalMinutes)}</Text>
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
  const headline =
    result.myAchieved === true
      ? HEADLINE.achieved
      : result.myAchieved === false
        ? HEADLINE.failed
        : HEADLINE.pending;

  // 등장 연출 — 카드 팝인 하나만 쓴다(리그 화면의 다단계 연출은 풀스크린 화면 몫).
  // 결과가 넘어가며(큐) 같은 모달이 내용만 갈릴 때도 다시 팝 되도록 결과 키에 묶는다.
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    }).start();
  }, [result.challengeId, result.date, pop]);

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
            <Text style={s.title}>{headline.title}</Text>

            {/* 캐릭터 + 글로우 — 리그의 뱃지 자리를 대신한다.
                에셋마다 가로세로비가 달라 contain으로 넣는다(원 안에 들어가는 쪽이 기준) */}
            <View style={s.glow}>
              <Image
                source={headline.image}
                style={s.character}
                resizeMode="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel={headline.imageLabel}
                testID="group.challengeResult.character"
              />
            </View>

            {/* 어떤 챌린지의 어느 날 결과인가 */}
            <Text style={s.label}>{result.label}</Text>
            <Text style={s.date}>{monthDay(result.date)} 결과</Text>

            {/* 명단 — 3상(달성·미달성·집계 중)을 뭉개지 않는다 */}
            <ScrollView style={s.lists} showsVerticalScrollIndicator={false}>
              <NameSection
                title="달성"
                icon="checkmark-circle"
                color={T.night.green}
                members={result.achievers}
                goalMinutes={result.goalMinutes}
              />
              <NameSection
                title="미달성"
                icon="close-circle"
                color={T.night.muted}
                members={result.failed}
                goalMinutes={result.goalMinutes}
              />
              <NameSection
                title="집계 중"
                icon="hourglass-outline"
                color={T.night.gold}
                members={result.pending}
                goalMinutes={result.goalMinutes}
              />
            </ScrollView>

            {/* 내기가 걸려 있던 결과에만 — 금액 없이, 지급 시점 안내만 */}
            {result.hadBet && (
              <Text style={s.betHint}>내기 코인은 정산 후 알림으로 알려드려요</Text>
            )}
          </Animated.View>

          <TouchableOpacity
            style={s.cta}
            activeOpacity={0.85}
            onPress={onClose}
            testID="group.challengeResult.close"
          >
            <Text style={s.ctaText}>확인</Text>
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

  lists: { alignSelf: 'stretch', flexGrow: 0, maxHeight: 220 },
  section: { alignItems: 'center', marginBottom: T.space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  sectionTitle: { ...T.text.caption, fontWeight: '700' },

  // 이름 | 근거 분 — 카드 진행 리스트(progressRow)와 같은 배치다: 이름 왼쪽, 분 오른쪽.
  // 행마다 가운데 정렬하면 이름 길이만큼 분이 좌우로 흔들려 세로로 훑을 수 없다(PR #493 리뷰).
  // 폭은 화면 전체가 아니라 읽기 좋은 상한까지만 벌리고, 그 덩어리를 가운데 둔다.
  memberRows: { alignSelf: 'center', width: '100%', maxWidth: 260 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: T.space.sm,
    marginTop: 4,
  },
  memberName: { ...T.text.body, color: T.night.cream, flexShrink: 1 },
  memberMinutes: {
    ...T.text.caption,
    color: T.night.muted,
    fontVariant: ['tabular-nums'],
  },

  betHint: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.accentLight,
    textAlign: 'center',
    marginTop: T.space.sm,
  },

  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.xxl,
  },
  ctaText: { ...T.text.body, fontWeight: '700', color: T.white },
});
