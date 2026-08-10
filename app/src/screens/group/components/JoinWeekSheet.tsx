import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import {
  BET_INSUFFICIENT_BALANCE,
  BET_SCREENTIME_PERMISSION_REQUIRED,
  INVALID_SESSION_DATES,
  groupErrorCode,
  joinWeekSessions,
} from '@/services/groupApi';
import { logGroupBetJoined } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import type { MissionCategory, MissionType } from '@/types/dto/group';
import { fmtMonthDayDow } from '../challengeSchedule';
import BetBalanceRow from './BetBalanceRow';

// 「이번 주 남은 날 전부」 예약 확인 시트(GROMO-1276 — N14·§C2).
//
// 총액을 **먼저** 보여주고 즉시 전액을 묶는다(N15 즉시 에스크로 체감) — "N일 × 참가비 = 총
// 얼마가 지금 빠진다"가 CTA를 누르기 전에 읽혀야 한다. 전송은 sessionDates **명시 지정**이다
// (LLD §2.2) — 화면에 보여준 날짜 집합과 서버가 계산한 집합이 어긋나면 보여준 것과 다른 돈이
// 나간다. 전체가 한 트랜잭션(전부 성공 or 전부 실패, 총액 선검사)이다.
//
// **부분 예약(§C2)**: 잔액이 전부를 감당하지 못해도 전체 버튼을 죽이고 끝내지 않는다 —
// 몇 개까지 되는지 적고, 가능한 날수만 예약하는 축소 액션을 준다(앞 날짜부터 — 먼저 오는
// 날이 먼저 도는 날이다). 그 선택도 유저가 한다(ux §09).
//
// 취소는 날짜 단위다(§C8 — 일괄 취소 없음) — 노트가 그 사실을 미리 말한다. 「회차」 금지(N28).

/**
 * 예약 대상 하루 — 날짜와 **그 날짜에 실제로 나갈 금액**.
 *
 * 금액이 날짜마다 다를 수 있다(#570 리뷰): 이미 열린 회차는 **개설 시점 stake가 박제**돼 있고,
 * 아직 열리지 않은 날은 예약하는 순간 **지금 설정값**이 박제된다. 관리자가 참가비를 바꾼 직후엔
 * 두 값이 갈리므로, 단가 하나로 합계를 내면 화면이 안내한 금액과 실제 차감이 어긋난다.
 */
export interface JoinWeekEntry {
  date: string; // 'YYYY-MM-DD'
  stake: number;
}

export interface JoinWeekSheetProps {
  groupId: string;
  challengeId: string;
  // 미션 요약 라벨(카드와 같은 문장).
  label: string;
  // 예약 대상(오름차순) — 카드가 repeatDays·오늘 참여 가능 여부·날짜별 금액에서 산출.
  entries: JoinWeekEntry[];
  // 창형이면 시작 시각 'HH:mm' — 행마다 날짜 옆에 적는다. 하루형은 null.
  startTimeLabel: string | null;
  // 참여 계측의 미션 축(단건 참가와 같은 파라미터 — 채택률을 같은 축에서 본다).
  missionType: MissionType;
  missionCategory: MissionCategory;
  onClose: () => void;
  // 성공(또는 성공과 같게 취급) — 카드가 시트를 내리고 부모 재조회를 태운다.
  onDone: () => void;
}

export default function JoinWeekSheet({
  groupId,
  challengeId,
  label,
  entries,
  startTimeLabel,
  missionType,
  missionCategory,
  onClose,
  onDone,
}: JoinWeekSheetProps) {
  const { coins, coinsLoaded, coinsVersion, latestCoinsVersion, refresh } = useCoins();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 서버가 확정한 잔액 부족(BetSheet insufficientVerdict 패턴 그대로 — #570 codex) — refresh가
  // 실패하거나 낡은 큰 잔액이 남아 있어도 "그 총액으로는 안 된다"는 이미 확정이다. 안 잠그면
  // 같은 실패를 반복 전송한다. 판정은 그 총액 **이상**에 유효하고, 푸는 건 판정보다 **나중에**
  // 도착한 권위 있는 잔액이 낼 수 있다고 말할 때뿐이다.
  const [insufficientVerdict, setInsufficientVerdict] = useState<{
    total: number;
    coinsVersion: number;
  } | null>(null);
  const submitLock = useRef(false);

  // 시트를 열 때 서버 잔액을 다시 받는다(BetSheet §0-3과 같은 이유).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 합계는 **날짜별 금액의 합**이다 — 단가 × 일수로 내면 박제값이 다른 날에서 어긋난다.
  const total = entries.reduce((sum, e) => sum + e.stake, 0);
  // 모든 날짜가 같은 금액인가 — 문구를 가른다(아래 표기 주석).
  const uniformStake = entries.length > 0 && entries.every((e) => e.stake === entries[0].stake);
  // 잔액 미상이면 부족 판정을 하지 않는다(3상) — 판정은 서버 총액 선검사가 확정해 준다.
  const loaded = !!coinsLoaded;
  const insufficient = loaded && total > coins;
  /**
   * 서버 판정이 **이 금액**을 막고 있는가 (#570 codex ⑥).
   *
   * 판정은 "그 총액 이상은 안 된다"는 사실이라 **시도 금액 단위로** 물어야 한다: 전체(3일)가
   * 거절된 뒤 잔액이 조금 들어오면 축소분(2일)은 낼 수 있는데, 전체 총액으로만 재면 부분 예약
   * 버튼까지 영영 잠긴다. 푸는 것도 같은 축이다 — 판정 **이후 버전**의 권위 있는 잔액이
   * **그 금액**을 감당한다고 말할 때만 연다(크기만 보면 판정 직후의 낡은 잔액이 스스로 푼다).
   */
  function verdictBlocks(amount: number): boolean {
    if (insufficientVerdict === null || amount < insufficientVerdict.total) return false;
    const fresherBalanceCovers =
      loaded && coinsVersion > insufficientVerdict.coinsVersion && amount <= coins;
    return !fresherBalanceCovers;
  }
  const serverInsufficient = verdictBlocks(total);
  // 부분 예약 제안 — **권위 있는 잔액**으로만 계산한다(앞 날짜부터: 먼저 오는 날이 먼저 도는 날).
  // 날짜별 금액이 다르므로 '몫 나눗셈'이 아니라 **누적합이 잔액을 넘기 직전까지** 담고,
  // 서버 판정이 막는 금액이면 뒤에서부터 줄인다 — 막힌 금액을 다시 보내는 제안은 무의미하다.
  const partialEntries = (() => {
    if (!loaded || (!insufficient && !serverInsufficient)) return [];
    const picked: JoinWeekEntry[] = [];
    let sum = 0;
    for (const e of entries) {
      if (sum + e.stake > coins) break;
      sum += e.stake;
      picked.push(e);
    }
    while (picked.length > 0 && verdictBlocks(picked.reduce((acc, e) => acc + e.stake, 0))) {
      picked.pop();
    }
    // 전부 담겼다면 축소가 아니다 — 전체 CTA와 같은 요청이 되므로 제안하지 않는다.
    return picked.length === entries.length ? [] : picked;
  })();
  const affordableCount = partialEntries.length;
  const partialTotal = partialEntries.reduce((sum, e) => sum + e.stake, 0);
  const fullDisabled = submitting || insufficient || serverInsufficient;

  function failAndReload(title: string, message: string) {
    Alert.alert(title, message);
    onDone();
  }

  async function submit(targets: JoinWeekEntry[]) {
    if (submitting || submitLock.current || targets.length === 0) return;
    const targetDates = targets.map((e) => e.date);
    // 서버 판정이 막는 금액은 다시 보내지 않는다 — CTA 잠금과 **같은 축**(시도 금액 기준)이다.
    const targetTotal = targets.reduce((sum, e) => sum + e.stake, 0);
    if (verdictBlocks(targetTotal)) return;
    submitLock.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await joinWeekSessions(groupId, challengeId, targetDates);
      // 참여 계측(#570 codex ⑧) — **성공 시에만**, **행동 1건**으로 센다(3일 예약을 3건으로
      // 부풀리면 '참여 결심 수' 축이 무너진다 — analyticsEvents 주석). 규모는 session_count로.
      //
      // ⚠️ 수치는 **요청값이 아니라 응답값**에서 뽑는다(#570 codex ④): join-week은 다른 기기에서
      // 이미 참가한 날짜를 **조용히 건너뛴다**(LLD §2.2). 보낸 날짜로 세면 실제로 걸리지 않은
      // 날까지 지표에 실리고, 전부 건너뛴 요청(joined 빈 배열 — 새로 걸린 게 없다)까지 성공
      // 이벤트가 된다. `joined` 필드를 모르는 응답(구·경계)만 보낸 값으로 폴백한다.
      const joinedDates = result?.joined?.map((j) => j.sessionDate);
      const actual =
        joinedDates === undefined ? targets : targets.filter((e) => joinedDates.includes(e.date));
      if (actual.length > 0) {
        logGroupBetJoined({
          // stake는 하루치 축을 유지한다(총액이 아니다) — 날짜별로 갈리면 최대 하루치.
          stake: Math.max(...actual.map((e) => e.stake)),
          session_count: actual.length,
          mission_type: missionType,
          mission_category: missionCategory,
        });
      }
      // 예약분 전액이 그 자리에서 묶였다(N15) — 잔액을 곧바로 맞춘다.
      refresh();
      onDone();
      return;
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 총액 기준 잔액 부족(LLD §2.2) — 판정을 상태로 승격해 CTA를 잠근다(BetSheet 패턴).
        // 전체·부분 대상 재계산은 refresh가 실어 온 **권위 있는 새 잔액**이 도착한 뒤에만 돈다.
        // 버전은 클로저가 아니라 latestCoinsVersion()에서 읽는다 — 요청이 나가 있는 사이 도착한
        // (차감 전) 잔액이 '판정 이후'로 세어져 즉시 다시 열리는 창을 막는다(BetSheet와 동일).
        case BET_INSUFFICIENT_BALANCE:
        case 'INSUFFICIENT_CURRENCY':
          refresh();
          setInsufficientVerdict({ total: targetTotal, coinsVersion: latestCoinsVersion() });
          break;
        // 보낸 날짜가 더 이상 유효하지 않다(자정 경계·챌린지 변경 경합) — 낡은 화면이다.
        case INVALID_SESSION_DATES:
          failAndReload('참여할 수 있는 날이 바뀌었어요', '최신 상태로 새로고침할게요.');
          return;
        case BET_SCREENTIME_PERMISSION_REQUIRED:
          failAndReload('참여할 수 없어요', '스크린타임 권한을 허용해야 참여할 수 있어요.');
          return;
        case 'NOT_FOUND':
        case 'CHALLENGE_NOT_FOUND':
          failAndReload('사라진 챌린지예요', '방장이 챌린지를 없앴을 수 있어요.');
          return;
        case 'MEMBER_ONLY':
          failAndReload('그룹원만 이용할 수 있어요', '그룹에서 나갔거나 더 이상 멤버가 아니에요.');
          return;
        case 'GUEST_FORBIDDEN':
          failAndReload('로그인이 필요해요', '게스트는 코인을 쓸 수 없어요.');
          return;
        default:
          setErrorMsg('참여하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      submitLock.current = false;
    }
    setSubmitting(false);
  }

  return (
    <SheetShell onClose={submitting ? () => {} : onClose} asModal dismissible={!submitting}>
      <Text style={s.title}>이번 주 남은 날</Text>
      <Text style={s.sub}>{label}</Text>

      {/* 날짜별 참가비 — 행이 먼저 읽히고 합계가 아래에서 못을 박는다. 금액은 **행마다** 다를 수
          있다(이미 열린 회차의 박제값 vs 앞으로 박제될 설정값). */}
      <View style={s.dayList} testID="group.bet.week.days">
        {entries.map((e) => (
          <View
            key={e.date}
            style={s.dayRow}
            accessible
            accessibilityLabel={`${fmtMonthDayDow(e.date)} 참가비 ${e.stake}코인`}
          >
            <Text style={s.dayText}>
              {fmtMonthDayDow(e.date)}
              {startTimeLabel !== null ? ` ${startTimeLabel}` : ''}
            </Text>
            <Text style={s.dayStake}>{e.stake}</Text>
          </View>
        ))}
      </View>

      {/* 합계 + 잔액 — 잔액 표기는 N46 단독 소유 컴포넌트(1424) 재사용. 차감 후 값 병기 금지.
          문구는 금액이 갈리는지에 따라 나뉜다: 전부 같으면 종전대로 `N일 × S코인 = 합계 T코인`
          (단가가 정보다), 갈리면 **단가를 지우고 `N일 · 합계 T코인`** 으로 합계만 말한다 —
          날짜별 금액은 위 행에 이미 다 적혀 있고, 없는 단가를 지어내면 그게 곧 거짓이 된다. */}
      <Text style={s.totalText} testID="group.bet.week.total">
        {uniformStake
          ? `${entries.length}일 × ${entries[0].stake}코인 = 합계 ${total}코인`
          : `${entries.length}일 · 합계 ${total}코인`}
      </Text>
      <BetBalanceRow label="합계" amount={total} coins={loaded ? coins : null} />

      {/* 즉시 에스크로 + 취소 단위(§C8 — 날짜 단위, 일괄 취소 없음). */}
      <View style={s.note}>
        <Text style={s.noteText}>
          참여하면 {total}코인이 지금 모두 빠져나가요. 취소는 하루씩 따로 할 수 있어요 — 시작 전
          날짜는 시작 전까지 전액 돌려받아요.
        </Text>
      </View>

      {/* 서버가 확정한 부족 — 새 잔액이 아직 안 와 부족분·부분 제안을 계산할 수 없을 때의 안내.
          잔액이 도착하면 아래 insufficient 블록이 부족분·축소 제안까지 이어받는다(BetSheet 규칙). */}
      {serverInsufficient && !insufficient && <Text style={s.error}>코인이 부족해요</Text>}
      {/* 부분 예약 안내(§C2) — 전체가 안 되는 이유와 되는 범위를 같은 자리에서 말한다. */}
      {insufficient && (
        <Text style={s.error} testID="group.bet.week.shortage">
          코인이 {total - coins} 부족해요.
          {affordableCount > 0
            ? ` ${affordableCount}일(${partialTotal}코인)만 참여할 수 있어요`
            : ' 참여할 수 있는 날이 없어요'}
        </Text>
      )}
      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, fullDisabled && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={fullDisabled}
        onPress={() => submit(entries)}
        accessibilityRole="button"
        testID="group.bet.week.submit"
      >
        {submitting ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.submitText}>{entries.length}일 전부 참여</Text>
        )}
      </TouchableOpacity>

      {/* 잔액 부족 시 축소 액션 — 전체 버튼을 죽이고 끝내지 않는다(§C2). 선택은 유저가 한다. */}
      {insufficient && affordableCount > 0 && !submitting && (
        <TouchableOpacity
          style={s.partialBtn}
          activeOpacity={0.8}
          onPress={() => submit(partialEntries)}
          accessibilityRole="button"
          testID="group.bet.week.partial"
        >
          <Text style={s.partialText}>
            {affordableCount}일만 참여 ({partialTotal}코인)
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={s.ghostBtn}
        activeOpacity={0.7}
        disabled={submitting}
        onPress={onClose}
        testID="group.bet.week.close"
      >
        <Text style={s.ghostText}>그만두기</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },
  dayList: { marginTop: T.space.lg, gap: T.space.xs },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.sm,
  },
  dayText: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  dayStake: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  totalText: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.ink,
    marginTop: T.space.md,
    fontVariant: ['tabular-nums'],
  },
  note: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, lineHeight: 19 },
  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },
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
  // 축소 액션 — 주 CTA보다 약한 아웃라인(돈이 덜 나가는 대안이지 취소가 아니다).
  partialBtn: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.sm,
  },
  partialText: { ...T.text.label, color: T.accent },
  ghostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
