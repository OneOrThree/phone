import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import {
  BET_INSUFFICIENT_BALANCE,
  BET_SCREENTIME_PERMISSION_REQUIRED,
  BET_SESSION_CLOSED,
  groupErrorCode,
  joinNextSession,
} from '@/services/groupApi';
import { getAuthSessionGeneration } from '@/services/api';
import { promptSessionExpired, USER_NOT_FOUND } from '@/services/sessionErrors';
import { logGroupBetJoined } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { todayStrKst } from '@/utils/localDate';
import type { MissionCategory, MissionType } from '@/types/dto/group';
import { fmtMonthDayDow } from '../challengeSchedule';
import BetBalanceRow from './BetBalanceRow';

// 다음 활성일 1건 예약 확인 시트(GROMO-1419 — N45·FR-31-1).
//
// 비활성 요일 카드의 「8/12(수) 참여하기」가 연다. 예약 대상이 **미래 날짜**임을 확인 단계에서
// 못 박는다 — 오늘 것으로 오인한 채 돈이 나가면 안 된다(FR-31-1: 버튼 문구도 날짜로 쓴다).
// 미래 회차라 진행분·남은 시간 경고 블록은 없다(LLD §6.2 — 진행분이 없어 성립 불가).
//
// 잔액 표기는 BetBalanceRow(N46 단독 소유 — 1424)를 그대로 재사용한다. 이 시트가 자체 표기를
// 정의하는 것은 금지다. 잔액 부족 **차단**(CTA 잠금)은 시트 몫으로 유지한다(FR-32).
//
// 에러 표현은 BetSheet 규칙 그대로다 — 재시도해 볼 만한 실패는 인라인, 이 시트에서 재시도해도
// 영원히 같은 결과인 실패는 Alert + 닫기 + 재조회(onDone).

export interface JoinNextSheetProps {
  groupId: string;
  challengeId: string;
  // 미션 요약 라벨(카드와 같은 문장 — missionLabel ?? categoryLabel).
  label: string;
  // 예약 대상 날짜 'YYYY-MM-DD' — 카드 nextSessionAt에서 파생. 서버 join-next가 같은 함수
  // (RepeatSchedule.next)를 타므로 보통은 화면과 결제 대상이 같지만(LLD §2.2), 자정을 넘겨
  // 제출하면 서버가 새로 계산한 다음 활성일이 이 값과 달라질 수 있다 — 아래 submit의 드리프트
  // 방어 2겹(선제 차단 + 응답 대조)이 그 축이다(#570 codex).
  sessionDate: string;
  // 창형이면 시작 시각 'HH:mm' — 하루형은 null(자정 시작이라 시각 표기가 노이즈다).
  startTimeLabel: string | null;
  stake: number;
  // 참여 계측의 미션 축(단건 참가와 같은 파라미터 — 채택률을 같은 축에서 본다).
  missionType: MissionType;
  missionCategory: MissionCategory;
  // 딤 탭·그만두기 — 카드가 시트만 내린다.
  onClose: () => void;
  // 성공(또는 성공과 같게 취급) — 카드가 시트를 내리고 부모 재조회를 태운다.
  onDone: () => void;
}

export default function JoinNextSheet({
  groupId,
  challengeId,
  label,
  sessionDate,
  startTimeLabel,
  stake,
  missionType,
  missionCategory,
  onClose,
  onDone,
}: JoinNextSheetProps) {
  const { coins, coinsLoaded, coinsVersion, latestCoinsVersion, refresh } = useCoins();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 서버가 확정한 잔액 부족(BetSheet insufficientVerdict 패턴 — #570 codex ②). refresh가 실패하거나
  // 낡은 큰 잔액이 남아 있어도 "이 참가비로는 안 된다"는 이미 확정이다 — 안 잠그면 같은 실패를
  // 반복 전송한다. 푸는 건 판정 **이후 버전**의 권위 있는 잔액이 감당한다고 말할 때뿐이다
  // (크기만 보면 판정 직후의 낡은 잔액이 판정을 스스로 즉시 풀어 버린다).
  const [insufficientVerdict, setInsufficientVerdict] = useState<{
    stake: number;
    coinsVersion: number;
  } | null>(null);
  // 같은 틱 연타 방지 — state는 리렌더 뒤에야 보인다(BetSheet submit 관행).
  const submitLock = useRef(false);
  // 시트를 연 시점의 KST 기준일 — 자정을 넘겨 제출하면 화면의 '다음 활성일'이 이미 낡은
  // 값이라(서버는 새 오늘 기준으로 다시 계산한다) 돈이 다른 날짜에 걸릴 수 있다. 흔한 드리프트
  // 경로는 제출 직전 재검증으로 **선제 차단**한다(#570 codex — betForTomorrow의 고정 관행과 짝).
  const [openedTodayKst] = useState<string>(() => todayStrKst());
  const sessionDayLabel = fmtMonthDayDow(sessionDate);

  // 시트를 열 때 서버 잔액을 다시 받는다 — 낡은 잔액으로 CTA를 열어 주지 않는다(BetSheet §0-3).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 잔액을 모르면 부족 판정을 하지 않는다 — 모르는 값으로 사용자를 잠그지 않는다(BetSheet F1).
  const insufficient = !!coinsLoaded && stake > coins;
  // 판정 이후에 도착한 잔액이 '낼 수 있다'고 말하는가 — 그때만 서버 판정을 푼다(BetSheet와 동일).
  const balanceOverridesVerdict =
    insufficientVerdict !== null &&
    !!coinsLoaded &&
    coinsVersion > insufficientVerdict.coinsVersion &&
    stake <= coins;
  // 참가비는 이 시트에서 바꿀 수 없다(개설자가 정한 값) — 판정은 같은 금액에 그대로 유효하다.
  const serverInsufficient =
    insufficientVerdict !== null && stake >= insufficientVerdict.stake && !balanceOverridesVerdict;
  const disabled = submitting || insufficient || serverInsufficient;

  function failAndReload(title: string, message: string) {
    Alert.alert(title, message);
    onDone();
  }

  async function submit() {
    if (disabled || submitLock.current) return;
    // 자정을 넘겼다 — 화면의 다음 활성일이 낡았을 수 있다. 돈이 나가기 **전에** 끊고 다시 열게
    // 한다(성공 후 안내보다 선제 차단이 낫다 — 흔한 드리프트 경로는 전부 여기서 잡힌다).
    if (todayStrKst() !== openedTodayKst) {
      failAndReload(
        '날짜가 바뀌었어요',
        '자정이 지나 예약할 날짜가 달라졌을 수 있어요. 최신 상태로 다시 열어주세요.',
      );
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    // 요청 직전의 인증 세대 — 유저 부재 분기의 로그아웃 판정용(sessionErrors.ts 주석).
    const requestSessionGeneration = getAuthSessionGeneration();
    try {
      const joined = await joinNextSession(groupId, challengeId);
      // 참여 계측(#570 codex ⑧) — 성공 시에만. 예약도 참여 결심 1건이다(session_count=1).
      // 금액은 서버가 확정한 박제값(joined.stake)을 우선한다 — 화면 값과 갈렸다면 실제 나간 쪽이
      // 지표에 남아야 한다.
      logGroupBetJoined({
        stake: joined.stake ?? stake,
        session_count: 1,
        mission_type: missionType,
        mission_category: missionCategory,
      });
      // 예약분도 즉시 전액 에스크로다(N15) — 빠진 잔액을 곧바로 맞춘다.
      refresh();
      // 드리프트 잔여 경로(요청이 나가 있는 사이 자정 경과 등) — 참가는 이미 성립했으므로 되돌리지
      // 않되(환불 아님 — 취소는 사용자의 선택으로 남긴다), **실제 예약된 날짜를 침묵 없이** 알린다.
      // 화면이 보여준 날짜와 결제된 날짜가 다른데 조용히 성공 처리하면 사용자는 모른 채 당한다.
      if (joined.sessionDate !== sessionDate) {
        Alert.alert(
          '예약된 날짜가 바뀌었어요',
          `${fmtMonthDayDow(joined.sessionDate)}로 예약됐어요. 원하지 않으면 그 날짜가 시작되기 전에 참여를 취소할 수 있어요.`,
        );
      }
      onDone();
      return;
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 이미 예약된 상태 = 원하던 결과다(BetSheet의 BET_ALREADY_JOINED 규칙).
        case 'BET_ALREADY_JOINED':
          refresh();
          onDone();
          return;
        // 서버가 확정한 잔액 부족 — 판정을 상태로 승격해 CTA를 잠근다(BetSheet 패턴 · #570 ②).
        // 버전은 클로저(coinsVersion)가 아니라 latestCoinsVersion()에서 읽는다 — 요청이 나가 있는
        // 사이 도착한(차감 전) 잔액이 '판정 이후'로 세어져 CTA를 즉시 다시 여는 창을 막는다.
        case BET_INSUFFICIENT_BALANCE:
        case 'INSUFFICIENT_CURRENCY':
          refresh();
          setInsufficientVerdict({ stake, coinsVersion: latestCoinsVersion() });
          break;
        // SCREEN_TIME 권한 가드(N50) — 이 시트에서 재시도해도 같은 결과다.
        case BET_SCREENTIME_PERMISSION_REQUIRED:
          failAndReload('참여할 수 없어요', '스크린타임 권한을 허용해야 참여할 수 있어요.');
          return;
        // 예약 창이 닫혔다(경합) — 최신 상태로 다시 열게 한다.
        case BET_SESSION_CLOSED:
        case 'BET_NOT_OPEN':
          failAndReload('참여할 수 없어요', '참여할 수 있는 시간이 지났어요. 새로고침할게요.');
          return;
        // 유저 부재(GROMO-1247) — 사라진 건 챌린지가 아니라 **내 계정**이다. 새로고침해도
        // 같은 실패가 오므로 failAndReload가 아니라 재로그인으로 보낸다.
        case USER_NOT_FOUND:
          promptSessionExpired(requestSessionGeneration);
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
      <Text style={s.title}>{sessionDayLabel} 참여하기</Text>
      <Text style={s.sub}>
        {label}
        {startTimeLabel !== null ? ` · ${startTimeLabel} 시작` : ''}
      </Text>

      {/* 즉시 에스크로 체감(N15) + 취소 규칙(N22 — 시작 전 참가는 시작까지). 「회차」 금지(N28). */}
      <View style={s.note}>
        <Text style={s.noteText}>
          참가하면 참가비 {stake}코인이 바로 빠져나가요. {sessionDayLabel}
          {startTimeLabel !== null ? ` ${startTimeLabel}` : ''} 시작 전까지는 참여를 취소하고 전액
          돌려받을 수 있어요.
        </Text>
      </View>

      {/* 잔액 표기 — N46 단독 소유 컴포넌트 재사용(1424). 미상이면 '—'(3상). */}
      <BetBalanceRow amount={stake} coins={coinsLoaded ? coins : null} />

      {/* 서버가 확정한 부족 — 잔액이 아직 안 와 부족분을 계산할 수 없을 때만 이 문장이 선다.
          잔액이 도착하면 CTA 라벨이 규격대로 부족분을 들고 있으므로 같은 말을 두 번 하지 않는다. */}
      {serverInsufficient && !insufficient && <Text style={s.error}>코인이 부족해요</Text>}
      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, disabled && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={disabled}
        onPress={submit}
        accessibilityRole="button"
        testID="group.bet.joinNext.submit"
      >
        {submitting ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.submitText}>
            {insufficient
              ? `코인이 부족해요 (${stake - coins} 필요)`
              : `${sessionDayLabel} 참여하기`}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={s.ghostBtn}
        activeOpacity={0.7}
        disabled={submitting}
        onPress={onClose}
        testID="group.bet.joinNext.close"
      >
        <Text style={s.ghostText}>그만두기</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  // 제목·노트·CTA 규격은 BetSheet와 같다 — 같은 섹션의 형제 시트.
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },
  note: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, lineHeight: 19 },
  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },
  submitBtn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
  ghostBtn: {
    minHeight: 44,
    paddingVertical: T.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
