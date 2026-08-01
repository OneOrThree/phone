import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { createBet, groupErrorCode, joinBet } from '@/services/groupApi';
import { logGroupBetCreated, logGroupBetJoined } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { todayStr } from '@/utils/localDate';
import type { GroupChallengeResponse } from '@/types/dto/group';
import type { BetSheetMode } from './ChallengeCard';
import { categoryLabel, missionLabel } from './challengeLabel';

// 내기 시트(개설·참가) — 명세 docs/app/group-bet-plan.md §1, 계약 정본 docs/back/group-bet-plan.md §2.
//
// 한 컴포넌트가 두 모드를 겸한다 — 두 화면의 내용이 '판돈을 고르나, 정해진 판돈을 받아들이나'
// 하나만 다르고 나머지(챌린지 요약·내 코인·잔액 검사·에러 분기·CTA 규격)가 전부 같기 때문이다.
//
// ⚠️ 잔액은 CoinContext가 정본이다(§0-3). 시트를 열 때 refresh()로 서버 잔액을 다시 받는다 —
//    판돈 차감·정산 지급은 **서버가** 하므로 앱의 마운트 시점 잔액은 이미 낡아 있을 수 있고,
//    낡은 잔액으로 CTA를 열어 주면 INSUFFICIENT_CURRENCY로만 실패를 알게 된다.
// ⚠️ 성공·중복(BET_ALREADY_JOINED) 뒤에도 refresh() — 판돈이 빠진 잔액을 곧바로 맞춘다.
//
// 에러 표현(그룹 시트 3종 공통 규칙 + 이 시트의 예외):
//   · 다시 시도해 볼 만한 실패(잔액 부족·알 수 없는 오류)는 **인라인 문구**. 시트를 열어 둔다.
//   · 이 시트에서 재시도해도 영원히 같은 결과인 실패(이미 내기 있음·이미 달성·마감)는
//     **Alert + 시트 닫기 + 재조회**다. 카드가 쥔 상태가 이미 낡았다는 뜻이라 시트를 붙잡아 두면
//     같은 실패만 반복한다. Alert를 쓰는 이유는 인라인 문구가 시트와 함께 사라지기 때문이다
//     (ChallengeComposeSheet의 nonParticipants 안내와 같은 이유).

// 서버 허용 판돈(백 명세 결정 8) — 그 외 값은 BET_INVALID_STAKE로 튕긴다.
const STAKE_OPTIONS = [10, 30, 50, 100] as const;
// 기본 선택은 **가장 낮은 판돈**. 돈이 걸린 선택의 기본값은 사용자가 아무 생각 없이 눌러도
// 가장 덜 잃는 쪽이어야 한다(챌린지 목표분 칩의 '가운데 기본값'과 기준이 다른 이유).
const STAKE_DEFAULT = STAKE_OPTIONS[0];

const CREATE_NOTE =
  '오늘 목표를 달성한 사람끼리 팟을 나눠 가져요. 아무도 달성 못 하면 전액 환불돼요.';
const JOIN_NOTE = '참가하면 판돈이 바로 빠져나가요. 오늘 목표를 달성해야 팟을 나눠 가져요.';

// 잔액 부족 — CTA 라벨이 부족분을 직접 들고 있다(legacy ShopScreen의 '부족 (N 더 필요)' 규격).
function shortageLabel(shortage: number): string {
  return `코인이 부족해요 (${shortage} 필요)`;
}

export interface BetSheetProps {
  groupId: string;
  // 내기를 걸 챌린지 — 요약 라벨·challengeId·현재 내기(참가 모드의 판돈·팟·참가자)를 여기서 읽는다.
  challenge: GroupChallengeResponse;
  mode: BetSheetMode;
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 성공(또는 성공과 같게 취급하는 상태) — 부모가 시트를 내리고 챌린지를 재조회한다.
  onDone: () => void;
}

export default function BetSheet({ groupId, challenge, mode, onClose, onDone }: BetSheetProps) {
  const { coins, refresh } = useCoins();
  const [stake, setStake] = useState<number>(STAKE_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const bet = challenge.bet ?? null;
  const label = missionLabel(challenge) ?? categoryLabel(challenge);
  const isCreate = mode === 'create';
  // 참가 모드의 판돈은 개설자가 이미 정했다 — 고를 수 없다.
  const amount = isCreate ? stake : (bet?.stake ?? 0);
  const shortage = amount - coins;
  const insufficient = shortage > 0;
  // 참가 모드인데 내기가 없다 = 카드가 열어 줄 수 없는 조합(부모가 막는다). 방어적으로 CTA만 잠근다.
  const disabled = submitting || insufficient || (!isCreate && bet === null);

  // 시트를 열 때 서버 잔액을 다시 받는다(§0-3).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 재시도해도 같은 결과인 실패 — 알리고, 닫고, 부모가 재조회한다.
  function failAndReload(title: string, message: string) {
    Alert.alert(title, message);
    onDone();
  }

  async function submit() {
    if (disabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (isCreate) {
        await createBet(groupId, challenge.id, { stake: amount, date: todayStr() });
        logGroupBetCreated({ stake: amount });
      } else {
        if (bet === null) return;
        await joinBet(groupId, bet.betId);
        logGroupBetJoined({ stake: amount });
      }
      // 판돈이 빠진 잔액을 곧바로 맞춘다(응답을 기다리지 않는다 — 시트는 이미 닫힌다).
      refresh();
      onDone();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 이미 참가한 상태 = 원하던 결과다. 새 참가가 아니므로 계측은 발행하지 않는다
        // (GroupFindSheet의 ALREADY_MEMBER와 같은 규칙).
        case 'BET_ALREADY_JOINED':
          refresh();
          onDone();
          return;
        case 'BET_ALREADY_EXISTS':
          failAndReload('이미 오늘 내기가 있어요', '다른 그룹원이 먼저 내기를 열었어요.');
          return;
        case 'BET_ALREADY_ACHIEVED':
          failAndReload('참가할 수 없어요', '이미 오늘 목표를 달성해서 참가할 수 없어요');
          return;
        case 'BET_CLOSED':
          failAndReload('마감된 내기예요', '이미 마감돼 참가할 수 없어요.');
          return;
        // 서버가 센 잔액이 앱과 다르다 — 다시 받아 CTA가 실제 잔액으로 판정하게 한다.
        case 'INSUFFICIENT_CURRENCY':
          refresh();
          setErrorMsg('코인이 부족해요');
          break;
        default:
          setErrorMsg(
            isCreate
              ? '내기를 열지 못했어요. 잠시 후 다시 시도해주세요.'
              : '참가하지 못했어요. 잠시 후 다시 시도해주세요.',
          );
      }
      setSubmitting(false);
    }
  }

  return (
    // 전송 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal>
      <Text style={s.title}>{isCreate ? '내기 걸기' : '내기 참가'}</Text>
      <Text style={s.sub}>{label}</Text>

      <View style={s.balance}>
        <Text style={s.balanceLabel}>내 코인</Text>
        <Text style={s.balanceValue} testID="group.bet.balance">
          {coins}
        </Text>
      </View>

      {isCreate ? (
        <>
          <Text style={s.label}>판돈</Text>
          <View style={s.chips}>
            {STAKE_OPTIONS.map((v) => {
              const on = stake === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[s.chip, on ? s.chipOn : null]}
                  activeOpacity={0.8}
                  onPress={() => setStake(v)}
                  testID={`group.bet.stake.${v}`}
                >
                  <Text style={[s.chipText, on ? s.chipTextOn : null]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
        <>
          <View style={s.statRow}>
            <View style={s.stat}>
              <Text style={s.statLabel}>판돈</Text>
              <Text style={s.statValue}>{bet?.stake ?? 0}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statLabel}>현재 팟</Text>
              <Text style={s.statValue}>{bet?.pot ?? 0}</Text>
            </View>
          </View>

          <Text style={s.label}>참가자 {bet?.participants?.length ?? 0}명</Text>
          <View style={s.participants}>
            {(bet?.participants ?? []).map((p) => (
              <Text key={p.userId} style={s.participant} numberOfLines={1}>
                {p.nickname}
              </Text>
            ))}
          </View>
        </>
      )}

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={15} color={T.accent} style={s.noteIcon} />
        <Text style={s.noteText}>{isCreate ? CREATE_NOTE : JOIN_NOTE}</Text>
      </View>

      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, disabled && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={disabled}
        onPress={submit}
        testID="group.bet.submit"
      >
        {submitting ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.submitText}>
            {insufficient ? shortageLabel(shortage) : isCreate ? '내기 열기' : '참가하기'}
          </Text>
        )}
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  // 제목·부제·라벨·칩·노트·CTA 규격은 ChallengeComposeSheet와 같다 — 같은 섹션의 형제 시트다.
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },

  // 내 코인 — 앱에서 재화를 처음 노출하는 자리라(§0-2) 강조 칩 하나로 못 박는다.
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.accentBg,
    borderRadius: 12,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  balanceLabel: { ...T.text.label, color: T.inkSub },
  balanceValue: {
    ...T.text.subtitle,
    color: T.accentDeep,
    fontVariant: ['tabular-nums'],
  },

  label: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.lg,
    marginBottom: T.space.sm,
  },

  chips: { flexDirection: 'row', gap: T.space.sm },
  chip: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  chipOn: { backgroundColor: T.accentBg, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.inkSub, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: T.accentDeep, fontWeight: '700' },

  // 참가 모드의 판돈·팟 — 고를 수 없는 값이라 칩이 아니라 읽기용 타일로 둔다.
  statRow: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.lg },
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

  participants: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
  participant: {
    ...T.text.caption,
    color: T.inkSub,
    backgroundColor: T.chipBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 3,
    maxWidth: 140,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  noteIcon: { marginTop: 2 },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  // 시트 CTA = 52 / r16 (그룹 시트 공통 규격).
  submitBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
});
