import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { BET_ALREADY_FAILED, createBet, groupErrorCode, joinBet } from '@/services/groupApi';
import { logGroupBetCreated, logGroupBetJoined } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { useUser } from '@/store/UserContext';
import { todayStr } from '@/utils/localDate';
import type { GroupChallengeResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
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
// 잔액 3상(3차 리뷰 F1·F3) — '모르는 값으로 사용자를 잠그지 않는다'가 원칙이다:
//   · coinsLoaded === false : **미상**. 잔액 자리는 '—', 부족 판정을 하지 않고 CTA는 열어 둔다.
//     판정은 서버에 맡긴다(서버가 400 INSUFFICIENT_CURRENCY로 확정해 준다). 인라인 재시도 한 줄을 둔다.
//   · coinsLoaded === true  : 그 값으로 부족분까지 계산해 **누르기 전에** 막는다.
//   · 서버가 부족을 확정(INSUFFICIENT_CURRENCY)하면 그 판정을 앱 상태로 승격해 CTA를 잠근다 —
//     refresh가 실패해 낡은 큰 잔액이 남아 있어도 "이 판돈으로는 안 된다"는 이미 확정이다.
//     판정은 **그 판돈 이상**에 유효하다(10이 안 되면 30·50·100도 안 된다) — 더 낮은 금액으로
//     내려갈 때만 근거가 사라진다(코덱스 리뷰). 해제 조건은 하나 더 있다: 판정 **이후에 도착한**
//     권위 있는 잔액이 낼 수 있다고 말하면 푼다(클로드 리뷰) — 시트를 열어 둔 사이 코인이 들어와도
//     참가 모드는 판돈을 바꿀 방법이 없어(칩이 없다) 영영 잠긴 채로 남기 때문이다.
//     '이후에 도착한'을 coinsVersion으로 판정하는 이유: 판정 직후의 잔액은 아직 낡은 값이라
//     크기만 보면 판정이 스스로를 즉시 풀어 버린다.
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

// 몰수 룰(계약 확정 정책) — 승자 0명이면 환불이 아니라 **전액 소멸**이다. 돈이 걸리는 자리라
// 개설·참가 양쪽 모두에서 고지한다(구 문구 '전액 환불돼요'는 V19 룰 — 그대로 두면 거짓말이 된다).
const CREATE_NOTE =
  '오늘 목표를 달성한 사람끼리 적립금을 나눠 가져요. 아무도 달성하지 못하면 참가비는 사라져요.';
const JOIN_NOTE =
  '참가하면 참가비가 바로 빠져나가요. 오늘 목표를 달성해야 적립금을 나눠 가져요. 아무도 달성하지 못하면 참가비는 사라져요.';
// SCREEN_TIME 내기의 측정 한계 고지(계약 §2 "카드·시트 안내 문구 필수") — 15분 눈금 측정 위로
// 코인이 움직인다는 사실을 돈이 나가기 전에 알린다.
const SCREEN_TIME_BET_NOTE =
  '스크린타임은 15분 단위로 집계돼 오차가 있을 수 있어요. 집계가 늦거나 누락되면 미달성으로 판정될 수 있어요.';

// 잔액 미상 — 값 자리는 '—'(진행 리스트의 미집계 표기와 같은 규칙), 사유와 재시도는 한 줄로 둔다.
const BALANCE_UNKNOWN = '—';
const BALANCE_FAILED_CAPTION = '잔액을 불러오지 못했어요';
// 이미 달성 — 카드의 진입 차단 사유와 **같은 문장**을 쓴다(같은 사실을 두 자리에서 달리 말하지 않는다).
const BET_ACHIEVED_CAPTION = '이미 오늘 목표를 달성해서 참가할 수 없어요';
// 개설도 같은 사실로 막히지만(개설자는 자동 참가라 서버가 BET_ALREADY_ACHIEVED로 거절한다)
// 막히는 동작이 달라 문장을 따로 둔다 — 카드의 BET_ACHIEVED_CREATE_CAPTION과 같은 문장이다.
const BET_ACHIEVED_CREATE_CAPTION = '이미 오늘 목표를 달성해서 내기를 열 수 없어요';
// SCREEN_TIME은 차단 방향이 반대다(계약 §2 참가 가드 행 — BET_ALREADY_FAILED) —
// '이미 달성'이 아니라 '이미 목표 초과(확정 패배)'가 막는다. 카드와 같은 문장이다.
const BET_FAILED_CAPTION = '이미 목표를 초과해서 참가할 수 없어요';
const BET_FAILED_CREATE_CAPTION = '이미 목표를 초과해서 내기를 열 수 없어요';
// 전송 중 — 딤 탭·백을 막는 대신(F10) 멈춘 화면이 아님을 한 줄로 알린다.
const SUBMITTING_CAPTION = '처리 중이에요…';

// 잔액 부족 — CTA 라벨이 부족분을 직접 들고 있다(legacy ShopScreen의 '부족 (N 더 필요)' 규격).
function shortageLabel(shortage: number): string {
  return `코인이 부족해요 (${shortage} 필요)`;
}

export interface BetSheetProps {
  groupId: string;
  // 내기를 걸 챌린지 — 요약 라벨·challengeId·현재 내기(참가 모드의 판돈·팟·참가자)를 여기서 읽는다.
  challenge: GroupChallengeResponse;
  mode: BetSheetMode;
  // 내가 오늘 목표를 이미 달성했는가 — **개설 모드**의 잠금 근거다.
  // 참가 모드는 서버가 준 bet.myAchievedNow를 쓰지만, 내기가 없는 챌린지엔 bet 자체가 없어
  // 이 사실을 실어 올 자리가 없다. 부모(GroupRoomScreen)가 challenge.memberProgress에서
  // 파생해 내려준다 — 카드의 개설 진입점이 쓰는 근거와 같은 값이다.
  myAchieved: boolean;
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 성공(또는 성공과 같게 취급하는 상태) — 부모가 시트를 내리고 챌린지를 재조회한다.
  onDone: () => void;
}

export default function BetSheet({
  groupId,
  challenge,
  mode,
  myAchieved,
  onClose,
  onDone,
}: BetSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { coins, coinsLoaded, coinsVersion, latestCoinsVersion, refresh } = useCoins();
  // SCREEN_TIME의 차단 판정(이미 목표 초과)은 부모가 내려주지 않아 — myAchieved prop은 FOCUS
  // 의미(이미 달성)로 이미 배선돼 있고 부모(GroupRoomScreen)는 A3 전유다 — 내 진행 행을
  // 시트가 직접 읽는다. 카드의 myBlockedNow와 같은 근거·같은 3상 규칙이다.
  const { userId } = useUser();
  const [stake, setStake] = useState<number>(STAKE_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 서버가 확정한 잔액 부족(F3). 잔액을 다시 못 받아도 이 판돈이 안 된다는 사실은 이미 정해졌다.
  // '어느 판돈에서, 어느 잔액 버전에서' 확정됐는지까지 쥔다 — 해제 조건이 그 둘로 갈린다(위 주석).
  const [insufficientVerdict, setInsufficientVerdict] = useState<{
    stake: number;
    coinsVersion: number;
  } | null>(null);
  // 게스트 차단 — 시트를 로그인 안내로 갈아 끼운다(GroupInviteSheet의 게스트 경로와 같은 형태).
  const [guestBlocked, setGuestBlocked] = useState(false);
  const bet = challenge.bet ?? null;
  const label = missionLabel(challenge) ?? categoryLabel(challenge);
  const isCreate = mode === 'create';
  // 참가 모드의 판돈은 개설자가 이미 정했다 — 고를 수 없다.
  const amount = isCreate ? stake : (bet?.stake ?? 0);
  const shortage = amount - coins;
  // 잔액을 모르면 부족 판정 자체를 하지 않는다 — 모르는 값으로 사용자를 잠그지 않는다(F1).
  const insufficient = coinsLoaded && shortage > 0;
  // 판정 이후에 도착한 잔액이 '낼 수 있다'고 말하는가 — 그때만 서버 판정을 푼다.
  const balanceOverridesVerdict =
    insufficientVerdict !== null &&
    coinsLoaded &&
    coinsVersion > insufficientVerdict.coinsVersion &&
    shortage <= 0;
  const serverInsufficient =
    insufficientVerdict !== null && amount >= insufficientVerdict.stake && !balanceOverridesVerdict;
  // 시트를 연 뒤 상태가 확정됐다면(부모가 살아 있는 challenge를 갈아 끼운다) 참가도 개설도 반드시
  // 거절된다 — 카드가 진입 시점에 쓰는 기준을 시트도 끝까지 민다. 시트를 닫지는 않는다:
  // 팟·참가자(개설은 고른 판돈)를 보고 있는 화면을 걷을 이유는 없어 CTA만 잠그고 사유를 적는다.
  // 근거는 카테고리·모드별로 갈린다(카드 myBlockedNow·joinBlockedNow와 동일):
  //   FOCUS 개설  : 부모가 진행률에서 파생해 준 myAchieved(이미 달성 — BET_ALREADY_ACHIEVED)
  //   FOCUS 참가  : 서버가 준 내기의 myAchievedNow(같은 가드)
  //   SCREEN_TIME : 내 진행 행의 achieved === false(이미 목표 초과 — BET_ALREADY_FAILED).
  //                 myAchievedNow·myAchieved는 '잠정 달성'이라 차단 근거로 쓰지 않는다 —
  //                 하루가 끝나야 확정되는 값으로 잠그면 사실상 전원이 잠긴다(계약 §2).
  const isScreenTime = challenge.missionCategory === 'SCREEN_TIME';
  const isWindowChallenge = challenge.missionType === 'TIME_WINDOW';
  const myFailedNow =
    isScreenTime &&
    !!userId &&
    challenge.memberProgress?.find((p) => p.userId === userId)?.achieved === false;
  const achievedBlocked = isScreenTime
    ? myFailedNow
    : isCreate
      ? myAchieved
      : bet?.myAchievedNow === true;
  // 참가 모드인데 내기가 없다 = 카드가 열어 줄 수 없는 조합(부모가 막는다). 방어적으로 CTA만 잠근다.
  const disabled =
    submitting ||
    insufficient ||
    serverInsufficient ||
    achievedBlocked ||
    (!isCreate && bet === null);

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
        logGroupBetCreated({
          stake: amount,
          mission_type: challenge.missionType,
          mission_category: challenge.missionCategory,
        });
      } else {
        // 도달할 수 없는 조합이지만(위 disabled 가드), 도달하면 공통 문구로 떨어뜨린다 —
        // 그냥 return하면 submitting이 true로 남아 시트가 영영 잠긴다(F12).
        if (bet === null) throw new Error('bet is missing');
        await joinBet(groupId, bet.betId);
        logGroupBetJoined({
          stake: amount,
          mission_type: challenge.missionType,
          mission_category: challenge.missionCategory,
        });
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
        // 누가 먼저 열었는지는 앱이 알 수 없다 — 내 성공 직후의 재진입일 수도 있다(F6).
        // 사실 범위 안에서만 말한다.
        // 그 '내가 먼저 열었을' 가능성 때문에 잔액도 다시 받는다(코덱스 리뷰) — 응답만 타임아웃되고
        // 서버에선 개설이 성립했다면 판돈은 이미 빠졌는데 전역 잔액은 차감 전 값으로 남는다.
        // 남이 먼저 연 경우라면 재조회는 같은 값을 다시 확인할 뿐이라 무해하다.
        // ⚠️ 취소·정산된 내기도 이 코드로 온다(챌린지·날짜 유니크가 행을 남긴다 — 같은 날 재개설은
        //    v1 불가 확정, 백로그 1051). 그 경우 재조회 후에도 화면에 내기가 없어 '이미 열려
        //    있어요'는 거짓말이 된다 — 두 사실을 모두 덮는 문장으로 말한다.
        case 'BET_ALREADY_EXISTS':
          refresh();
          failAndReload(
            '오늘은 내기를 열 수 없어요',
            '이미 오늘 내기가 있어요. 진행 중이면 새로고침 후 참가할 수 있고, 취소했거나 끝난 내기는 오늘 다시 열 수 없어요.',
          );
          return;
        case 'BET_ALREADY_ACHIEVED':
          failAndReload('참가할 수 없어요', '이미 오늘 목표를 달성해서 참가할 수 없어요');
          return;
        // SCREEN_TIME의 반대 방향 가드(계약 §2) — 이미 목표를 초과해 확정 패배한 사람의 판돈
        // 투입을 서버가 막는다. 이 시트에서 재시도해도 오늘은 영원히 같은 실패다 — 닫고 재조회한다.
        case BET_ALREADY_FAILED:
          failAndReload(
            isCreate ? '내기를 열 수 없어요' : '참가할 수 없어요',
            isCreate ? BET_FAILED_CREATE_CAPTION : BET_FAILED_CAPTION,
          );
          return;
        // 같은 코드가 세 뜻이다(계약 §2·§4) — 참가는 '이미 마감', 개설은 'date가 오늘(KST)이
        // 아님', **창 내기의 개설·참가는 '오늘 창이 이미 끝남'**(now ≥ 오늘 창 endAt).
        // 아직 만들지도 않은 내기에 "이미 마감돼 참가할 수 없어요"는 뜻이 통하지 않는다(F4).
        case 'BET_CLOSED':
          failAndReload(
            isCreate
              ? isWindowChallenge
                ? '내기를 열 수 있는 시간이 지났어요'
                : '오늘 내기만 열 수 있어요'
              : '마감된 내기예요',
            isCreate
              ? isWindowChallenge
                ? '오늘 시간대가 끝나 내기를 열 수 없어요. 내일 다시 열 수 있어요.'
                : '날짜가 바뀌었어요. 새로고침 후 다시 시도해주세요.'
              : '이미 마감돼 참가할 수 없어요.',
          );
          return;
        // 챌린지가 이미 비활성이다(GROMO-1025) — 시트의 마지막 성공 조회 이후 종료됐거나,
        // 재조회 실패로 낡은 ACTIVE 스냅샷을 보고 있던 경우다. 이 시트에서 재시도해도 영원히
        // 같은 실패라 닫고 재조회한다. 문구는 staleBetSheetAlert의 같은 사실 분기와 같은 문장이다.
        // ⚠️ 현재 서버는 이 코드를 **개설(createBet)에서만** 던진다 — joinBet은 챌린지 상태를
        //    보지 않는다(GroupBetService). 참가 분기는 도달 불가능한 선제 방어다: switch가 모드
        //    공용이고, 서버가 참가에도 같은 검사를 추가하면 그대로 대비된다(클로드 리뷰).
        case 'BET_CHALLENGE_INACTIVE':
          failAndReload(
            '끝난 챌린지예요',
            isCreate
              ? '종료된 챌린지에는 내기를 열 수 없어요.'
              : '종료된 챌린지의 내기에는 참가할 수 없어요.',
          );
          return;
        // 사라진 챌린지에 계속 걸어 봐야 결과는 같다 — 닫고 부모가 목록을 다시 받는다.
        case 'NOT_FOUND':
          failAndReload('사라진 챌린지예요', '방장이 챌린지를 없앴을 수 있어요.');
          return;
        // 챌린지가 아니라 **내기 자체**가 없다(계약 §2-2의 BET_NOT_FOUND — 404, 참가 경로).
        // 공통 문구('잠시 후 다시 시도')로 떨어뜨리면 영원히 같은 실패를 재시도하게 된다.
        case 'BET_NOT_FOUND':
          failAndReload('사라진 내기예요', '이미 없어진 내기예요. 최신 상태로 새로고침할게요.');
          return;
        // 그룹에서 빠졌다 — 재시도로 풀리지 않는다. 부모가 재조회하면서 방 자체를 정리한다.
        case 'MEMBER_ONLY':
          failAndReload('그룹원만 이용할 수 있어요', '그룹에서 나갔거나 더 이상 멤버가 아니에요.');
          return;
        // 게스트는 재화가 없다 — '잠시 후 다시 시도'는 거짓이라 로그인 안내로 갈아 끼운다(F5).
        case 'GUEST_FORBIDDEN':
          setGuestBlocked(true);
          break;
        // 서버가 센 잔액이 앱과 다르다 — 다시 받아 부족분을 적고, 판정 자체는 서버 것을 그대로 쓴다.
        // 판정 시점의 잔액 버전을 함께 남긴다 — 이 판정을 푸는 건 그보다 **나중에 도착한** 잔액뿐이다.
        // 버전은 클로저(coinsVersion)가 아니라 CoinContext의 latestCoinsVersion()에서 읽는다.
        // 클로저는 제출을 시작한 렌더의 값이라, 요청이 나가 있는 사이 도착한 잔액(시트 오픈 때
        // 시작한 조회가 늦게 끝난 경우 — 차감 전이라 '낼 수 있다'고 말한다)이 판정보다 **먼저**
        // 도착했는데도 '판정 이후'로 세어져 CTA를 즉시 다시 열고 같은 400만 반복한다.
        // 이 시트가 effect로 미러링한 ref도 같은 문제가 남는다 — 잔액이 적용된 직후 다음 렌더·
        // passive effect 전에 이 catch가 돌면 한 틱 낡은 값을 쓴다. 그래서 응답 적용과 **동시에**
        // 오르는 정본을 직접 읽는다(코덱스 리뷰).
        case 'INSUFFICIENT_CURRENCY':
          refresh();
          setInsufficientVerdict({ stake: amount, coinsVersion: latestCoinsVersion() });
          break;
        // 게이트 확대(전 조합 허용)가 아직 배포되지 않은 서버는 FOCUS×DURATION 밖의 내기를
        // 이 코드로 거절한다(구 GroupBetService). 앱이 진입점을 먼저 열어 둔 배포 공백기의
        // 실존 경로라 분기를 둔다 — default의 '잠시 후 다시 시도'는 이 서버에선 영원히 거짓이다
        // (클로드 리뷰). 게이트 확대 배포 후엔 자연히 도달 불가가 된다.
        case 'BET_FOCUS_ONLY':
          failAndReload(
            '아직 내기를 걸 수 없는 챌린지예요',
            '지금은 하루 목표 집중 챌린지에만 내기를 걸 수 있어요. 서버 업데이트 후 열 수 있어요.',
          );
          return;
        // 계약의 나머지 코드는 앱이 보내는 조합에서 도달할 수 없어 분기를 두지 않는다:
        // BET_INVALID_STAKE는 판돈이 칩의 허용값 {10,30,50,100}으로만 나가기 때문이다.
        // 도달했다면 서버 계약이 바뀐 것이라 '알 수 없는 오류'로 말하는 편이 사실에 가깝다.
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

  // ── 게스트 — 내기는 재화를 쓰는 기능이라 로그인 전에는 열리지 않는다(§5-3의 게스트 안내 규격) ──
  // 문구·버튼 규격은 GroupInviteSheet의 게스트 화면 그대로다.
  if (guestBlocked) {
    return (
      <SheetShell onClose={onClose} asModal>
        <Text style={s.title}>로그인하면 내기에 참여할 수 있어요</Text>
        <Text style={s.sub}>게스트는 코인을 쓸 수 없어요.</Text>
        <TouchableOpacity
          style={s.submitBtn}
          activeOpacity={0.85}
          onPress={() => {
            onClose();
            navigation.navigate('SettingsAccount');
          }}
          testID="group.bet.login"
        >
          <Text style={s.submitText}>로그인하러 가기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={onClose}>
          <Text style={s.ghostText}>다음에 할게요</Text>
        </TouchableOpacity>
      </SheetShell>
    );
  }

  return (
    // 전송 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal>
      <Text style={s.title}>{isCreate ? '내기 걸기' : '내기 참가'}</Text>
      <Text style={s.sub}>{label}</Text>

      <View style={s.balance}>
        <Text style={s.balanceLabel}>내 코인</Text>
        {/* 미상이면 숫자를 지어내지 않는다 — 0을 적으면 화면이 사용자의 재산을 거짓으로 말한다(F1). */}
        <Text style={[s.balanceValue, !coinsLoaded && s.balanceUnknown]} testID="group.bet.balance">
          {coinsLoaded ? coins : BALANCE_UNKNOWN}
        </Text>
      </View>

      {/* 잔액을 못 받았다 — 사유와 재시도를 한 줄로. CTA는 잠그지 않고 서버 판정에 맡긴다. */}
      {!coinsLoaded && (
        <View style={s.balanceRetryRow}>
          <Text style={s.balanceRetryText}>{BALANCE_FAILED_CAPTION}</Text>
          <TouchableOpacity
            onPress={() => refresh()}
            hitSlop={12}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="group.bet.balance.retry"
          >
            <Text style={s.balanceRetryLink}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      )}

      {isCreate ? (
        <>
          <Text style={s.label}>참가비</Text>
          {/* 전송 중에는 참가비를 못 바꾼다(코덱스 리뷰) — 10을 보낸 뒤 100을 누르면 서버엔 10이
              간 채 화면의 선택만 100이 되어, 사용자는 자기가 100을 걸었다고 오인한다.
              고른 칩만 남기고 나머지를 흐려 '지금 나간 금액'이 무엇인지 화면에 못 박는다. */}
          <View style={s.chips}>
            {STAKE_OPTIONS.map((v) => {
              const on = stake === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[s.chip, on ? s.chipOn : null, submitting && !on ? s.chipOff : null]}
                  activeOpacity={0.8}
                  disabled={submitting}
                  onPress={() => setStake(v)}
                  // 숫자만 읽히면 무엇을 고르는 자리인지·무엇이 골라졌는지 알 수 없다(F9).
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: submitting }}
                  accessibilityLabel={`참가비 ${v}코인`}
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
              <Text style={s.statLabel}>참가비</Text>
              <Text style={s.statValue}>{bet?.stake ?? 0}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statLabel}>현재 적립금</Text>
              <Text style={s.statValue}>{bet?.pot ?? 0}</Text>
            </View>
          </View>

          <Text style={s.label}>참가자 {bet?.participants?.length ?? 0}명</Text>
          {/* 참가자는 최대 10명이고 닉네임 길이·접근성 글꼴에 따라 줄 수가 늘어난다. 시트 패널은
              하단 고정 absolute라 높이 제한이 없으면 작은 화면에서 제목·내 코인 같은 위쪽 내용이
              화면 밖으로 밀려 확인할 수 없게 된다(코덱스 리뷰) — 이 영역만 스크롤로 가둔다.
              시트 본문 전체가 아니라 참가자 영역만 가두는 이유: 판돈·팟·CTA는 항상 보여야 한다. */}
          <ScrollView
            style={s.participantsScroll}
            contentContainerStyle={s.participants}
            // 시트 자체는 스크롤 뷰가 아니지만, 안드로이드에서 중첩 제스처를 막지 않게 함께 켠다.
            nestedScrollEnabled
            testID="group.bet.participants"
          >
            {(bet?.participants ?? []).map((p) => (
              <Text key={p.userId} style={s.participant} numberOfLines={1}>
                {p.nickname}
              </Text>
            ))}
          </ScrollView>
        </>
      )}

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={15} color={T.accent} style={s.noteIcon} />
        <Text style={s.noteText}>
          {isCreate ? CREATE_NOTE : JOIN_NOTE}
          {/* SCREEN_TIME은 측정 한계 고지를 한 줄 잇는다(계약 필수 문구) — 돈이 나가기 전이 마지막 고지 자리다. */}
          {isScreenTime ? `\n${SCREEN_TIME_BET_NOTE}` : ''}
        </Text>
      </View>

      {/* 서버가 확정한 부족. 잔액을 다시 받아 부족분(N)까지 알게 되면 CTA 라벨이 규격대로
          `코인이 부족해요 (N 필요)`를 말하므로(§1), 같은 문장을 두 번 적지 않는다. */}
      {serverInsufficient && !insufficient && <Text style={s.error}>코인이 부족해요</Text>}
      {/* 잠긴 CTA에는 사유가 붙어야 한다 — 카드가 쓰는 문장 그대로(카테고리·모드별로 갈린다). */}
      {achievedBlocked && (
        <Text style={s.error}>
          {isScreenTime
            ? isCreate
              ? BET_FAILED_CREATE_CAPTION
              : BET_FAILED_CAPTION
            : isCreate
              ? BET_ACHIEVED_CREATE_CAPTION
              : BET_ACHIEVED_CAPTION}
        </Text>
      )}
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

      {/* 전송 중엔 CTA도 딤 탭도 막혀 있다 — 최대 15초(axios 타임아웃) 동안 멈춘 화면으로
          보이지 않게 한 줄 세운다. 닫기를 열어 주는 쪽은 AbortController가 필요해 더 두껍다(F10). */}
      {submitting && <Text style={s.submittingCaption}>{SUBMITTING_CAPTION}</Text>}
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
  // 미상 '—' — 실제 값과 같은 무게로 두면 0코인과 구분되지 않는다(진행 리스트 progressNone과 같은 규칙).
  balanceUnknown: { color: T.inkFaint },

  // 잔액 조회 실패 한 줄 — 문구는 danger, 재시도는 accent 링크(그룹 화면 공통 배너 규격).
  balanceRetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.sm,
  },
  balanceRetryText: { ...T.text.caption, color: T.dangerInk },
  balanceRetryLink: { ...T.text.caption, color: T.accent },

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
  // 전송 중 — 고르지 않은 칩만 흐려서 '이미 확정된 금액'을 남긴다(CTA off와 같은 0.5).
  chipOff: { opacity: 0.5 },
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

  // 참가자 칩 3줄분(칩 높이 26 × 3 + 줄 간격 2 × 8)이 기본 상한 — 그 이상은 스크롤한다.
  // flexGrow:0을 함께 두는 이유: ScrollView는 기본이 flex:1이라 시트 안에서 남은 높이를
  // 다 차지해 버려, 참가자가 한 줄뿐일 때도 빈 공간이 생긴다.
  participantsScroll: { maxHeight: 94, flexGrow: 0 },
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
  // 전송 중 안내 — CTA 바로 아래 가운데 한 줄.
  submittingCaption: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: T.space.sm,
  },

  // 게스트 안내의 보조 버튼 — GroupInviteSheet의 ghost 규격 그대로.
  ghostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
    marginBottom: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
