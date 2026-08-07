// 지난 내기 결과 바텀시트 — GROMO-1099 (기존 Alert.alert 나열을 앱 디자인 언어로 교체).
//
// 데이터는 카드가 쥔 challenge.lastSettledBet 그대로다 — 신규 API 없음. 챌린지당 최신 정산
// 1건만 온다는 한계도 그대로(전체 히스토리는 백로그). 여기는 표현 전용이라 상태를 갖지 않는다.
//
// 정보는 기존 Alert가 담던 것을 전부 유지한다(스펙 요구):
//   날짜 · 참가비 · 적립금 · 참가자별 행(닉네임/달성 여부/정산 ±코인) · 상태 변형
//   (REFUNDED 전원 환불 / FORFEITED 적립금 소멸 — 승자 0명의 결말이 상태로 갈리므로
//    첫 줄 배너로 못 박는다, 기존 F8 결정 유지).
//
// 표기 규칙은 Alert 시절 그대로 물려받는다:
//   · payout은 '받은 금액'이라 그대로 쓰면 판돈 낸 사실이 지워진다 → 손익(payout - stake)으로.
//   · achieved·payout null(미판정)은 0으로 뭉개지 않는다 — '미판정'으로 따로 적는다(F7).
// 여기에 참가자별 판정 근거(정산에 쓴 기록/목표 분)를 얹는다(GROMO-1207) — 결과 모달(1191)과
// 같은 progressFormat 조각을 쓰고, 필드를 모르는 구서버(undefined)에서는 아예 그리지 않는다.
// 캐릭터는 신규 제작 없이 ChallengeResultModal의 앱 공용 에셋 3종을 재사용한다(GROMO-1087 관행)
// — 내 결과(달성/미달성/미판정·명단 밖)에 따라 고른다.
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import type {
  LastSettledBet,
  LastSettledBetResult,
  MissionCategory,
  MissionType,
} from '@/types/dto/group';
import {
  UNMEASURED,
  WINDOW_FOCUS_TOLERANCE_NOTICE,
  progressFraction,
  progressFractionA11y,
} from './progressFormat';

// 과거 정산분(progressMinutes null)의 음성 문구 — 시각은 progressFormat의 '—'(UNMEASURED)를
// 그대로 쓰되, 음성은 진행 리스트의 '아직 집계되지 않음'(unmeasuredA11y)이 아니라 확정 부재로
// 읽는다: 정산이 끝난 행의 null은 백필되지 않는 영구 상태다(codex 리뷰, group.ts 계약 주석).
const SNAPSHOT_MISSING_A11Y = '판정 기록 없음';

// 'YYYY-MM-DD' → '7월 31일' (ChallengeCard.monthDay와 같은 표기 — 형식이 다르면 원문 유지).
function monthDay(betDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(betDate);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : betDate;
}

// 내 결과별 캐릭터 — ChallengeResultModal.HEADLINE과 같은 에셋·같은 매핑(화풍 통일).
// image는 스크린리더가 못 읽으므로 상태를 말로 옮긴 label을 함께 둔다(같은 관행).
const CHARACTER = {
  achieved: {
    image: require('@/assets/character_happy.png'),
    imageLabel: '목표를 달성해 기뻐하는 캐릭터',
  },
  failed: {
    image: require('@/assets/character_sensitive.png'),
    imageLabel: '목표를 놓쳐 아쉬워하는 캐릭터',
  },
  pending: {
    image: require('@/assets/character_study.png'),
    imageLabel: '결과를 기다리는 캐릭터',
  },
} as const;

// 승자 0명의 결말 배너 — 구 룰(V19 이전)은 전원 환불(REFUNDED), 현 룰은 전액 몰수(FORFEITED).
// 모르는 상태는 배너 없이 인별 행만 그린다(Alert 시절의 else 강하 유지).
function statusBanner(status: LastSettledBet['status']): string | null {
  if (status === 'REFUNDED') return '달성한 사람이 없어 전원 환불됐어요';
  if (status === 'FORFEITED') return '아무도 달성하지 못해 참가비가 소멸됐어요';
  return null;
}

// 인별 행의 판정 라벨 — 3상(달성/미달성/미판정)을 뭉개지 않는다.
function verdictText(r: LastSettledBetResult): string {
  if (r.payout === null || r.achieved === null) return '미판정';
  return r.achieved ? '달성' : '미달성';
}

// 손익 표기 — +는 붙이고 0·음수는 그대로(Alert 시절 표기 규칙 유지). 미판정은 값 자리를 '—'로
// 비운다(진행 리스트의 미집계 표기와 같은 규칙 — 숫자를 지어내지 않는다).
function deltaText(r: LastSettledBetResult, stake: number): string {
  if (r.payout === null || r.achieved === null) return '—';
  const delta = r.payout - stake;
  return `${delta > 0 ? '+' : ''}${delta}`;
}

// 판정 근거(정산에 쓴 기록 분) — ChallengeResultModal.minutesText와 **같은 조각**(progressFormat,
// GROMO-1191의 규칙 그대로): 기록 null → '—'(미집계 — 0으로 뭉개지 않는다), 목표 falsy → 분모 생략.
// undefined(필드를 모르는 구서버)는 호출 전에 걸러진다 — 근거 표기 자체를 그리지 않는다.
function basisText(progressMinutes: number | null, goalMinutes: number | null): string {
  if (progressMinutes === null) return UNMEASURED;
  return progressFraction(progressMinutes, goalMinutes);
}

// 행 전체를 한 덩어리로 읽는다 — 따로 읽히면 '—'가 "대시"로 발음돼 미판정이라는 뜻이 사라진다
// (ChallengeCard.progressA11y와 같은 이유).
// 근거가 있으면(신서버) 닉네임 자리를 progressFormat의 a11y 조각으로 바꾼다 — 조각이 닉네임을
// 포함하므로('재영 60분 중 52분') 이름·근거·판정·손익이 한 문장으로 이어진다.
function rowA11y(r: LastSettledBetResult, stake: number, goalMinutes: number | null): string {
  // null(과거 정산분)은 unmeasuredA11y('아직 집계되지 않음')를 쓰지 않는다 — 그 문구는 진행
  // 리스트의 '아직 안 끝남'용이고, 정산이 끝난 행에서는 스냅샷이 영구히 없다는 뜻이라
  // '나중에 나타날 수 있음'으로 오독된다(codex 리뷰). 확정 부재는 '판정 기록 없음'으로 읽는다.
  const head =
    r.progressMinutes === undefined
      ? r.nickname
      : r.progressMinutes === null
        ? `${r.nickname} ${SNAPSHOT_MISSING_A11Y}`
        : progressFractionA11y(r.nickname, r.progressMinutes, goalMinutes);
  // 근거 조각이 붙었을 때(head ≠ 닉네임)는 뒤 상태와 쉼표로 끊는다 — '판정 기록 없음 미판정'
  // 처럼 상태 둘이 접속어 없이 이어지면 한 문장으로 어색하다(claude·codex 리뷰).
  // undefined(구서버) 경로는 쉼표 없이 기존 문장 그대로 — 바이트 동일성 유지.
  if (r.payout === null || r.achieved === null) {
    return head === r.nickname ? `${head} 미판정` : `${head}, 미판정`;
  }
  const delta = r.payout - stake;
  const verdictPart = `${r.achieved ? '달성' : '미달성'}, ${delta >= 0 ? '' : '마이너스 '}${Math.abs(delta)}코인`;
  // 실측 분('60분 중 52분')은 판정과 자연스럽게 이어지지만, '판정 기록 없음'은 판정과도 끊는다.
  return r.progressMinutes === null ? `${head}, ${verdictPart}` : `${head} ${verdictPart}`;
}

export interface LastBetResultSheetProps {
  lastBet: LastSettledBet;
  // 내 행 강조·캐릭터 선택에만 쓴다(카드의 myUserId 그대로).
  myUserId?: string | null;
  // 관용치 안내 판단용(GROMO-1207, codex 리뷰) — FOCUS 창은 판정에 5분 관용치가 있어
  // 근거 분(55/60분)이 달성 옆에서 모순으로 읽힌다. 결과 모달(1217)과 같은 조건·같은 문구.
  missionType?: MissionType | null;
  missionCategory?: MissionCategory | null;
  onClose: () => void;
}

export default function LastBetResultSheet({
  lastBet,
  myUserId,
  missionType,
  missionCategory,
  onClose,
}: LastBetResultSheetProps) {
  const banner = statusBanner(lastBet.status);
  // 분모(목표 분)는 정산 시점 스냅샷 — undefined(구서버)와 null(과거분·구 창)은 표기상 같은
  // '분모 생략'이라 여기서 null로 합친다. 근거 행 자체의 렌더 여부는 progressMinutes가 가른다.
  const goalMinutes = lastBet.goalMinutes ?? null;
  // 관용치 안내는 실측 분이 실제로 그려질 때만 — 구서버(undefined)·과거분(—)에는 모순될 숫자
  // 자체가 없다. 조건·문구는 결과 모달(GROMO-1217)과 동일 규칙.
  const showToleranceNotice =
    missionType === 'TIME_WINDOW' &&
    missionCategory === 'FOCUS' &&
    lastBet.results.some((r) => typeof r.progressMinutes === 'number');
  const myResult = myUserId ? lastBet.results.find((r) => r.userId === myUserId) : undefined;
  const character =
    myResult === undefined || myResult.achieved === null || myResult.payout === null
      ? CHARACTER.pending
      : myResult.achieved
        ? CHARACTER.achieved
        : CHARACTER.failed;

  return (
    // 그룹 탭 화면 위라 asModal 필수(SheetShell 주석 — 아니면 탭바 아래 깔린다).
    <SheetShell onClose={onClose} asModal>
      <View style={s.head} testID="group.bet.result.sheet">
        <View style={s.headText}>
          <Text style={s.title}>지난 내기 결과</Text>
          <Text style={s.sub}>
            {monthDay(lastBet.betDate)} · {lastBet.results.length}명 참가
          </Text>
        </View>
        {/* 캐릭터는 분위기 전달용 — 정보는 전부 텍스트에 있다. */}
        <Image
          source={character.image}
          style={s.character}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={character.imageLabel}
          testID="group.bet.result.character"
        />
      </View>

      {banner !== null && (
        <View style={s.banner}>
          <Text style={s.bannerText}>{banner}</Text>
        </View>
      )}

      {/* 참가비·적립금 — BetSheet 참가 모드의 읽기용 타일 규격 그대로(형제 시트 위계). */}
      <View style={s.statRow}>
        <View style={s.stat}>
          <Text style={s.statLabel}>참가비</Text>
          <Text style={s.statValue}>{lastBet.stake}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>적립금</Text>
          <Text style={s.statValue}>{lastBet.pot}</Text>
        </View>
      </View>

      {/* 창형 집중만 5분 관용치가 있다(서버 WINDOW_FOCUS_TOLERANCE_MINUTES) — 근거 분(55/60분)이
          달성 옆에서 모순으로 읽히지 않게 명단(숫자)보다 먼저 판정 규칙을 알린다. 조건·문구는
          결과 모달(GROMO-1217)과 동일, 스크롤 밖 고정 자리도 같은 이유(codex 리뷰). */}
      {showToleranceNotice && (
        <Text style={s.toleranceNotice} testID="group.bet.result.toleranceNotice">
          {WINDOW_FOCUS_TOLERANCE_NOTICE}
        </Text>
      )}

      {/* 인별 결과 — 닉네임/판정/손익. 참가자는 최대 10명이라 이 영역만 스크롤로 가둔다
          (BetSheet 참가자 영역과 같은 이유 — 제목·CTA는 항상 보여야 한다). */}
      <ScrollView style={s.resultsScroll} nestedScrollEnabled testID="group.bet.result.rows">
        {lastBet.results.map((r) => {
          const isMe = !!myUserId && r.userId === myUserId;
          const pending = r.payout === null || r.achieved === null;
          const delta = pending ? 0 : (r.payout as number) - lastBet.stake;
          return (
            <View
              key={r.userId}
              style={[s.row, isMe && s.rowMe]}
              accessible
              accessibilityLabel={rowA11y(r, lastBet.stake, goalMinutes)}
              testID={`group.bet.result.row.${r.userId}`}
            >
              <Text style={[s.nickname, isMe && s.nicknameMe]} numberOfLines={1}>
                {r.nickname}
              </Text>
              {/* 판정 근거(기록/목표 분, GROMO-1207) — undefined는 필드를 모르는 구서버라
               **아예 그리지 않는다**(기존 레이아웃 그대로). 결과 모달(1191)과 같은 조각·같은 결. */}
              {r.progressMinutes !== undefined && (
                <Text style={s.basis} testID={`group.bet.result.basis.${r.userId}`}>
                  {basisText(r.progressMinutes, goalMinutes)}
                </Text>
              )}
              <Text
                style={[
                  s.verdict,
                  !pending && r.achieved === true && s.verdictDone,
                  pending && s.verdictPending,
                ]}
              >
                {verdictText(r)}
              </Text>
              <Text
                style={[
                  s.delta,
                  pending && s.deltaPending,
                  !pending && delta > 0 && s.deltaPlus,
                  !pending && delta < 0 && s.deltaMinus,
                ]}
              >
                {deltaText(r, lastBet.stake)}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* 닫기 CTA — 그룹 시트 공통 규격(52/r16). 딤 탭으로도 닫힌다(SheetShell). */}
      <TouchableOpacity
        style={s.closeBtn}
        activeOpacity={0.85}
        onPress={onClose}
        accessibilityRole="button"
        testID="group.bet.result.close"
      >
        <Text style={s.closeText}>확인</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  // 제목·부제 규격은 BetSheet·ChallengeComposeSheet와 같다 — 같은 섹션의 형제 시트다.
  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  headText: { flex: 1 },
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },
  // 제목 옆 소형 — 결과 모달(108)처럼 크게 두면 하단 시트에서 명단을 밀어낸다.
  character: { width: 56, height: 56 },

  // 상태 배너 — 돈의 결말이 갈리는 문장이라 노트 칩으로 세운다(BetSheet note 규격).
  banner: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 12,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.md,
    marginTop: T.space.md,
  },
  bannerText: { ...T.text.caption, fontWeight: '600', color: T.inkSub },

  statRow: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.md },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    paddingVertical: T.space.md,
  },
  statLabel: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  statValue: { ...T.text.subtitle, color: T.ink, fontVariant: ['tabular-nums'] },

  // 인별 행 5줄분이 기본 상한 — 그 이상은 스크롤. flexGrow:0은 BetSheet 참가자 영역과 같은 이유
  // (ScrollView 기본 flex가 시트의 남은 높이를 다 차지해 빈 공간을 만든다).
  resultsScroll: { maxHeight: 190, flexGrow: 0, marginTop: T.space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.sm,
  },
  // 내 행 강조 — 카드 진행 리스트의 progressRowMe와 같은 칩 규격.
  rowMe: { backgroundColor: T.accentBg, borderRadius: 8 },
  nickname: { ...T.text.caption, fontWeight: '600', color: T.inkSub, flex: 1 },
  nicknameMe: { color: T.accentDeep, fontWeight: '700' },
  // 판정 근거 분 — 결과 모달 memberMinutes와 같은 결(보조 캡션·tabular-nums). 판정 라벨보다
  // 흐리게 둔다 — 근거는 판정을 보조하는 숫자지 그 자체가 결론이 아니다.
  // 판정 규칙 고지 — 결과 모달 toleranceNotice와 같은 역할(명단 직전 고정 한 줄). 이 시트는
  // 밝은 배경이라 색만 시트의 보조 톤(inkMuted)을 쓴다.
  toleranceNotice: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    marginBottom: T.space.sm,
  },
  basis: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, fontVariant: ['tabular-nums'] },
  verdict: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  verdictDone: { color: T.successInk },
  verdictPending: { color: T.inkFaint, fontWeight: '500' },
  // 손익 — 방향을 색으로도 가른다(±는 이미 텍스트에 있다 — 색맹 사용자도 기호로 읽는다).
  delta: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  deltaPlus: { color: T.successInk },
  deltaMinus: { color: T.dangerInk },
  deltaPending: { color: T.inkFaint, fontWeight: '500' },

  closeBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  closeText: { ...T.text.subtitle, color: T.white },
});
