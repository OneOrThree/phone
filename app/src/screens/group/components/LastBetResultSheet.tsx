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
// 캐릭터는 신규 제작 없이 ChallengeResultModal의 앱 공용 에셋 3종을 재사용한다(GROMO-1087 관행)
// — 내 결과(달성/미달성/미판정·명단 밖)에 따라 고른다.
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import type { LastSettledBet, LastSettledBetResult } from '@/types/dto/group';

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

// 행 전체를 한 덩어리로 읽는다 — 따로 읽히면 '—'가 "대시"로 발음돼 미판정이라는 뜻이 사라진다
// (ChallengeCard.progressA11y와 같은 이유).
function rowA11y(r: LastSettledBetResult, stake: number): string {
  if (r.payout === null || r.achieved === null) return `${r.nickname} 미판정`;
  const delta = r.payout - stake;
  return `${r.nickname} ${r.achieved ? '달성' : '미달성'}, ${delta >= 0 ? '' : '마이너스 '}${Math.abs(delta)}코인`;
}

export interface LastBetResultSheetProps {
  lastBet: LastSettledBet;
  // 내 행 강조·캐릭터 선택에만 쓴다(카드의 myUserId 그대로).
  myUserId?: string | null;
  onClose: () => void;
}

export default function LastBetResultSheet({ lastBet, myUserId, onClose }: LastBetResultSheetProps) {
  const banner = statusBanner(lastBet.status);
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

      {/* 인별 결과 — 닉네임/판정/손익. 참가자는 최대 10명이라 이 영역만 스크롤로 가둔다
          (BetSheet 참가자 영역과 같은 이유 — 제목·CTA는 항상 보여야 한다). */}
      <ScrollView
        style={s.resultsScroll}
        nestedScrollEnabled
        testID="group.bet.result.rows"
      >
        {lastBet.results.map((r) => {
          const isMe = !!myUserId && r.userId === myUserId;
          const pending = r.payout === null || r.achieved === null;
          const delta = pending ? 0 : (r.payout as number) - lastBet.stake;
          return (
            <View
              key={r.userId}
              style={[s.row, isMe && s.rowMe]}
              accessible
              accessibilityLabel={rowA11y(r, lastBet.stake)}
              testID={`group.bet.result.row.${r.userId}`}
            >
              <Text style={[s.nickname, isMe && s.nicknameMe]} numberOfLines={1}>
                {r.nickname}
              </Text>
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
