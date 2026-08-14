// 챌린지 결과 모달의 **소유자** — 정본 docs/prd/challenge/policy.md D3·N56·N57·N58 ·
// docs/prd/challenge/high-level-design.md §1 · information-architecture.md §4.3.
//
// ── 왜 화면이 아니라 루트인가 ──────────────────────────────────────────────────
// 예전 소유자는 GroupRoomScreen이었다. 즉 트리거가 **화면 좌표**("그룹방에 들어오면")에
// 못 박혀 있었다. 그런데 그룹 3차 개편이 "소속 1개면 그룹방 내장 렌더"를 폐지해 그룹 탭 랜딩이
// 카드 덱이 됐다 — 카드 덱만 보고 나가면 정산된 결과가 안 보인다. 더 결정적으로 **탈퇴자는
// MEMBER_ONLY로 그룹방에 못 들어가** 자기 결과를 영영 못 봤다(N53·C8).
// 그래서 트리거를 화면에서 떼어 냈다: 미확인 결과가 있으면 **그룹 흐름에서 도달한 화면 위에**
// 연다. 큐는 참가자 스코프(`GET /me/challenge-results`)라 소속 그룹 수와 무관하게 성립한다(N56).
//
// ── 겹침은 조정자가 막는다 ────────────────────────────────────────────────────
// 이 모달은 RN Modal이고, 그룹 화면들의 시트(내기·만들기·카드 시트·찾기·초대)와 그룹 덱
// 코치마크도 전부 RN Modal이다. 겹치면 딤이 포개지고 표시 순서가 플랫폼 재량이 된다.
// 그래서 **slot을 얻은 뒤에만 마운트한다**(store/OverlaySlotContext) — "렌더는 되고 가려진다"가
// 아니라 마운트 자체가 없다.
//
// ⚠️ 순서는 slot → 선점(claim) → 활성 claim 검증 → 노출 → ack 다(계약 D8 · N58 · IA §4.3).
//    ack를 노출 앞에 두면 렌더가 중단됐을 때 **어느 기기에서도 못 본다.**
//    claim/ack 구현은 W3(GROMO-1577) 소유다. 이 워크트리에 아직 없어서 같은 시그니처의 임시
//    대역(`./challengeResultClaim`)을 두고 **호출부는 진짜로 배선해 두었다** — 통합은 그 파일의
//    본문을 재수출 한 줄로 바꾸면 끝난다. TODO 주석으로 남기지 않은 이유는 그 파일 헤더 참고.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useUser } from '@/store/UserContext';
import { useCoins } from '@/store/CoinContext';
import { getMyChallengeResults } from '@/services/groupApi';
import { subscribeBetResultPush } from '@/services/betResultSignal';
import {
  logGroupChallengeResultClosed,
  logGroupChallengeResultShown,
} from '@/services/analyticsEvents';
import { OVERLAY_PRIORITY, useOverlaySlot } from '@/store/OverlaySlotContext';
import { readCurrentRoute, subscribeCurrentRoute } from '@/navigation/navigationRef';
import type { MyChallengeResultEntry } from '@/types/dto/group';
import {
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pickChallengeResults,
  type ChallengeResultCandidate,
} from './challengeResult';
import { setChallengeResultGate } from './challengeResultGate';
import {
  ackChallengeResult,
  claimChallengeResult,
  pendingAckChallengeResults,
  reconcileChallengeResultAck,
  type ChallengeResultClaim,
} from './challengeResultClaim';
import { isGroupFlowRoute } from './groupFlowRoute';
import ChallengeResultModal from './components/ChallengeResultModal';

export const CHALLENGE_RESULT_OVERLAY_ID = 'challenge:result';

// 선점을 놓쳤을 때(다른 기기가 같은 회차를 열고 있다) 다시 시도하기까지의 기본 지연.
// 서버가 `retryAfterMs`를 주면 그것을 쓴다 — 절대 시각은 받지 않는다(시계 어긋남).
// 서버가 그 값에 **리스 수명 상한**을 걸어 두었으므로 앱은 받은 값을 그대로 쓴다.
const CLAIM_RETRY_FALLBACK_MS = 30_000;
// 재시도에는 **상한을 두지 않는다** — 그룹 흐름 안에 머무는 동안만 도는 루프이고, 상한을 두면
// 오래 머무는 사용자가 결과를 영영 못 받는다. 대신 연속 실패가 이 횟수를 넘으면 간격을 2배로
// 늘려 조회 부하만 낮춘다(재시도마다 load()를 동반하므로 부하가 붙는다).
const CLAIM_BACKOFF_AFTER_FAILURES = 5;
const CLAIM_BACKOFF_FACTOR = 2;
// ack 재시도 — **모달을 다시 띄우지 않고 ack만** 재시도한다(N51 · IA §4.3). 로컬 1회 가드는
// 노출 시점에 이미 찍혔으므로(D2) 여기서 실패를 삼키면 그 회차는 다른 기기·재설치에서 다시 뜬다.
const ACK_RETRY_MS = 5_000;
const ACK_MAX_ATTEMPTS = 5;

// 조건 없는 제한적 재조회(계약 V2) — 그룹 흐름에 머무는 동안 30초 간격·최대 5회.
// 정산은 서버 배치라 화면 조작 없이 끝난다: 재조회 계기를 이벤트(포커스·포그라운드 복귀·
// BET_RESULT 푸시)에만 걸어 두면 "방에 가만히 있는데 아무 일도 안 일어나는" 구간이 남는다.
// 상한을 둬서 그룹 탭을 열어 둔 채 방치해도 조회가 무한히 돌지 않게 한다.
const REFETCH_INTERVAL_MS = 30_000;
const REFETCH_MAX = 5;

interface GroupFlowRouteState {
  inFlow: boolean;
  // 종료 푸시가 지목한 챌린지(GROMO-1088) — 딥링크가 GroupRoom 라우트 파라미터로 싣는다.
  focusChallengeId: string | null;
  // 지목의 신원(그룹+챌린지). 같은 방에서 다른 챌린지 푸시를 탭하면 이 값만 갈린다.
  focusKey: string | null;
}

// ⚠️ 라우트 **키**는 일부러 보지 않는다. 재조회 계기는 정본이 셋으로 못 박았다(policy §D3 · HLD):
//    셸 활성화(그룹 흐름 진입) · 포그라운드 복귀 · BET_RESULT 수신. 그룹 흐름 **내부** 이동
//    (목록 → 그룹방 → 설정 → 복귀)은 계기가 아니다 — 키를 계기로 삼으면 화면을 오갈 때마다
//    `GET /me/challenge-results`가 추가로 나간다.
const NOT_IN_FLOW: GroupFlowRouteState = {
  inFlow: false,
  focusChallengeId: null,
  focusKey: null,
};

// 이전 실행에서 ack가 끝내 실패한 회차를 조용히 수렴시킨다(N51). 노출 경로와 완전히 분리돼
// 있어 실패해도 화면에 아무 영향이 없다 — 다음 조회가 같은 대상을 다시 집어 온다.
async function reconcilePendingAcks(
  userId: string,
  candidates: ChallengeResultCandidate[],
): Promise<void> {
  try {
    const pending = await pendingAckChallengeResults(userId, candidates);
    await Promise.all(
      pending.map((entry) => reconcileChallengeResultAck(entry.sessionId).catch(() => false)),
    );
  } catch {
    // 조용한 복구다 — 실패는 다음 조회로 미룬다.
  }
}

function readGroupFlowRoute(): GroupFlowRouteState {
  const route = readCurrentRoute();
  if (!isGroupFlowRoute(route?.name)) return NOT_IN_FLOW;
  const params = route?.params;
  const challengeId =
    route?.name === 'GroupRoom' && typeof params?.challengeId === 'string'
      ? params.challengeId
      : null;
  const groupId = typeof params?.groupId === 'string' ? params.groupId : '';
  return {
    inFlow: true,
    focusChallengeId: challengeId,
    focusKey: challengeId === null ? null : `${groupId}:${challengeId}`,
  };
}

export default function ChallengeResultHost() {
  const { userId } = useUser();
  // 잔액은 CoinContext가 정본이다. 이 호스트는 **React 트리 안**이라 훅을 그대로 쓴다 —
  // coinRefreshSignal은 트리 **밖**(push.ts·navigationRef 등)의 모듈이 쓰는 우회로이고,
  // 여기서 그것을 거치면 "반영됐는가"(GROMO-1024의 boolean)를 잃고 한 단계 늦어질 뿐이다.
  const { refresh: refreshCoins } = useCoins();

  const [flow, setFlow] = useState<GroupFlowRouteState>(readGroupFlowRoute);
  const [queue, setQueue] = useState<ChallengeResultCandidate[]>([]);
  // 지금 쥐고 있는 선점(claim) — 이 회차만 렌더한다(D8). 아래 "선점" 블록 주석 참고.
  const [claim, setClaim] = useState<{ sessionId: string; token: string } | null>(null);
  // 선점을 놓쳤을 때 타이머가 올리는 재시도 계기.
  const [claimTick, setClaimTick] = useState(0);

  // onClose가 렌더 클로저 대신 읽는 최신 사본 — 닫는 순간의 토큰이 ack의 대상이다.
  const claimRef = useRef<{ sessionId: string; token: string } | null>(null);
  claimRef.current = claim;
  const claimingRef = useRef<string | null>(null);
  // 연속 선점 실패 횟수 — 백오프 판정용. 성공하면 0으로 되돌린다.
  const claimFailStreakRef = useRef(0);
  // ── 앱 활동 세대(generation) ──────────────────────────────────────────────
  // AppState가 바뀔 때마다 올린다. 선점·재검증 응답이 **비활성 구간을 건너뛰어** 도착하면
  // 그 값은 이미 낡았다: JS가 정지한 사이 lease(2분)가 만료되고 다른 기기가 재선점했을 수
  // 있는데, 우리가 든 응답은 여전히 ok:true다. 그것을 믿고 노출하면 두 기기가 같은 결과를
  // 동시에 본다 — ②가 만든 재검증 단계도 **비활성 구간을 건너뛴 응답에는 무의미**하다.
  // (같은 모양의 세대 가드가 groupApi.getMyChallengeResults의 requestGeneration에도 있다.)
  const activityGenRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    },
    [],
  );

  const queueRef = useRef<ChallengeResultCandidate[]>([]);
  const seqRef = useRef(0);
  const inFlowRef = useRef(flow.inFlow);
  inFlowRef.current = flow.inFlow;
  // 지금 떠 있는 모달의 노출 시각·키 — dwell_ms 계산과 노출 1회 판정용.
  const shownAtRef = useRef<number | null>(null);
  const shownKeyRef = useRef<string | null>(null);
  // 아직 큐에 올리지 못한 지목. 큐에 실린 순간 비운다(1회 소비) — 비우지 않으면 재조회마다
  // 사용자가 닫은 모달이 다시 뜬다. 반대로 **아직 결과가 없으면(집계 전) 소비하지 않는다**:
  // SESSION_END 푸시는 정산 **전**에 오므로 다음 조회가 이어받아야 한다(PR #566 리뷰 ③).
  const focusPendingRef = useRef<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);

  // 지목 무장 — 렌더 중 조정(GroupRoomScreen이 쓰던 것과 같은 패턴).
  // ⚠️ **새 지목이 왔을 때만** 다시 무장한다. 지목이 없는 라우트로 옮겼다고 지우지 않는다:
  //    결과 푸시로 GroupRoom에 들어온 뒤 정산 전에 GroupSettings 같은 하위 화면으로 이동하면
  //    challengeId가 사라지는데, 그때 지목을 버리면 뒤늦게 정산이 끝났을 때 **사용자가 탭한
  //    챌린지가 아니라 다른 최신 결과가 먼저** 뜬다. 내부 이동은 상태를 리셋할 사건이 아니다
  //    (routeKey를 재조회 계기에서 들어낸 것과 같은 축). 지목은 **소비되거나 그룹 흐름을
  //    완전히 벗어날 때** 사라진다(아래 이펙트).
  if (flow.focusKey !== null && focusKeyRef.current !== flow.focusKey) {
    focusKeyRef.current = flow.focusKey;
    focusPendingRef.current = flow.focusChallengeId;
  }

  // 그룹 흐름을 완전히 벗어나면 지목을 버린다 — 다음 진입은 새 사건이다.
  useEffect(() => {
    if (flow.inFlow) return;
    focusKeyRef.current = null;
    focusPendingRef.current = null;
  }, [flow.inFlow]);

  // ── 현재 라우트 추적 ──
  // 루트에 있어 useIsFocused를 못 쓴다. navigationRef의 'state' 이벤트로 대신한다.
  // 판정은 순수 함수(groupFlowRoute)가 쥐고, 읽지 못하면 '그룹 흐름 아님'으로 강하한다.
  useEffect(() => {
    const sync = () => {
      setFlow((prev) => {
        const next = readGroupFlowRoute();
        if (prev.inFlow === next.inFlow && prev.focusKey === next.focusKey) return prev;
        return next;
      });
    };
    sync();
    return subscribeCurrentRoute(sync);
  }, []);

  const applyQueue = useCallback((next: ChallengeResultCandidate[]) => {
    queueRef.current = next;
    setQueue(next);
    // 그룹방의 탈퇴 유예가 읽는 신호(challengeResultGate) — **판정에 성공했을 때만** 부른다.
    setChallengeResultGate(next.length > 0 ? 'pending' : 'none');
  }, []);

  // 조회·가드 읽기가 실패했다 = '없다'가 아니라 '모른다'. 이미 큐가 있으면 그 사실은 여전히 참이다.
  const publishUnknown = useCallback(() => {
    setChallengeResultGate(queueRef.current.length > 0 ? 'pending' : 'unknown');
  }, []);

  const load = useCallback(async () => {
    // 게스트는 참가 회차가 있을 수 없다 — 조회하지 않고 '없다'를 확정한다(그래야 탈퇴 유예가 풀린다).
    if (!userId) {
      applyQueue([]);
      return;
    }
    const seq = ++seqRef.current;
    // ⚠️ **판정을 시작하는 순간 먼저 미확정으로 되돌린다.**
    //    이전 조회가 'none'이었더라도 이 조회가 끝나기 전까지는 "없다"가 아니라 "모른다"다.
    //    되돌리지 않으면: 탈퇴자가 결과 딥링크로 GroupRoom에 진입할 때 이 비동기 조회가 도는
    //    사이 방의 getGroupDetail이 MEMBER_ONLY로 먼저 도착하고, 방은 낡은 'none'을 보고
    //    **즉시 onLeft** 한다 — 뒤늦게 결과를 찾아도 이미 그룹 흐름 밖이라 모달이 갈 곳이 없다.
    //    (이미 큐가 있으면 'pending'은 지금도 참이므로 그대로 둔다.)
    publishUnknown();
    let entries: MyChallengeResultEntry[] | null = null;
    try {
      const value = await getMyChallengeResults();
      // Array.isArray 방어 — mock·구서버의 비정상 값도 여기까지 올 수 있다.
      entries = Array.isArray(value) ? value : null;
    } catch {
      entries = null;
    }
    if (seq !== seqRef.current) return;
    if (entries === null) {
      publishUnknown();
      return;
    }

    const candidates = pickChallengeResults(entries);
    // 성공 응답은 **빈 배열도 정본**이다 — 대기하던 결과가 서버에서 제외되면(다른 기기에서
    // 챌린지 삭제 → FR-44-4) 큐에서도 사라져야 한다. 안 그러면 N48이 금지하는 이중 통지가 된다.
    // ── ack 복구(N51) — **노출과 무관한 조용한 수렴이다.** ──
    // 로컬 마커는 노출 시점에 찍히는데(D2) ack는 그 뒤에 실패할 수 있다. 그러면 다음 실행에서
    // filterUnseenChallengeResults가 마커를 보고 그 후보를 **버리므로** claim·ack 경로가 다시
    // 열리지 않고, 서버에는 영원히 미확인으로 남는다(그 회차의 푸시 클레임도 안 닫힌다).
    // 그래서 거르기 **전**에 "마커는 있는데 서버는 미확인"인 것을 골라 ack만 다시 보낸다.
    // 재노출은 하지 않는다 — 이미 본 것이 확실하다. 실패·예외는 삼킨다(다음 조회가 또 집는다).
    reconcilePendingAcks(userId, candidates).catch(() => undefined);

    let next: ChallengeResultCandidate[] = [];
    if (candidates.length > 0) {
      const unseen = await filterUnseenChallengeResults(userId, candidates);
      if (seq !== seqRef.current) return;
      // null = 가드 읽기 실패(계약 D1). '빈 정본'으로 반영하지 않는다.
      if (unseen === null) {
        publishUnknown();
        return;
      }
      // 지목은 같은 challengeId의 **최신 1건이 unseen일 때만** 큐 앞자리에 세우고 소비한다.
      // candidates는 sessionDate 내림차순이라 첫 매치가 최신이다.
      const focusId = focusPendingRef.current;
      let focused: ChallengeResultCandidate[] = [];
      if (focusId !== null) {
        const newest = candidates.find((c) => c.challengeId === focusId);
        if (newest && unseen.some((u) => u.sessionId === newest.sessionId)) {
          focused = [newest];
          focusPendingRef.current = null;
        }
      }
      next = [
        ...focused,
        ...unseen.filter((c) => !focused.some((f) => f.sessionId === c.sessionId)),
      ];
    }

    // 떠 있는 모달(맨 앞)은 유지한다 — 사용자가 읽고 있는 모달을 응답 하나로 걷어내지 않는다.
    // 유지 대상은 **실제로 떠 있는** 것뿐이다: 다른 오버레이에 밀려 대기 중인 결과까지 붙들면
    // 그 사이 탭한 지목이 뒤로 밀린다. 기준은 노출 이펙트가 세우는 shownKeyRef다.
    const head = queueRef.current[0];
    const merged =
      head !== undefined && shownKeyRef.current === head.sessionId
        ? [head, ...next.filter((c) => c.sessionId !== head.sessionId)]
        : next;
    applyQueue(merged);
  }, [applyQueue, publishUnknown, userId]);

  // 타이머 콜백이 렌더 클로저 대신 읽는 최신 load — 선점 재시도 이펙트가 load 신원 변화로
  // 재실행되지 않게 한다(재실행되면 진행 중인 선점이 취소된다).
  const loadRef = useRef(load);
  loadRef.current = load;

  // 계정 경계 — 이전 계정의 큐·노출 상태를 새 계정으로 물려주지 않는다. 마운트에도 돈다
  // (App.tsx가 userId로 트리를 가르므로 마운트 = 새 계정 트리의 시작이고, gate는 모듈 상태라
  // 이전 트리의 판정이 남아 있다).
  useEffect(() => {
    queueRef.current = [];
    setQueue([]);
    setClaim(null);
    shownAtRef.current = null;
    shownKeyRef.current = null;
    setChallengeResultGate('unknown');
  }, [userId]);

  // 그룹 흐름 **진입**(셸 활성화) · 지목 변경 → 조회. 그룹 흐름 밖에서는 아무것도 하지 않는다.
  // ⚠️ 그룹 흐름 **내부** 이동(목록 → 그룹방 → 설정 → 복귀)은 계기가 아니다 — 정본이 못 박은
  //    계기는 셋뿐이다(policy §D3 · HLD): 셸 활성화 · 포그라운드 복귀 · BET_RESULT 수신.
  useEffect(() => {
    if (!flow.inFlow) return;
    load();
  }, [flow.inFlow, flow.focusKey, load]);

  // 포그라운드 복귀 — 백그라운드에 있는 동안 정산이 끝났을 수 있다.
  // 그리고 **활동 세대를 올린다**: 이 전환을 건너뛴 선점·재검증 응답을 폐기하기 위해서다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      activityGenRef.current += 1;
      if (state !== 'active') return;
      // 아직 노출되지 않은 선점은 복귀 시점에 버리고 다시 검증한다 — 비활성 구간 동안
      // lease(2분)가 만료돼 다른 기기가 가져갔을 수 있고, 그 사실은 재검증으로만 알 수 있다.
      const held = claimRef.current;
      if (held !== null && shownKeyRef.current !== held.sessionId) {
        setClaim(null);
        setClaimTick((tick) => tick + 1);
      }
      if (!inFlowRef.current) return;
      load();
    });
    return () => sub.remove();
  }, [load]);

  // 정산 결과 푸시(BET_RESULT)를 포그라운드에서 받으면 즉시 재조회한다(GROMO-1580 ④).
  // 신호 모듈은 실물을 쓴다 — 이 구독이 빠지면 방에 머무는 동안 결과가 영영 안 뜬다.
  useEffect(
    () =>
      subscribeBetResultPush(() => {
        if (!inFlowRef.current) return;
        load();
      }),
    [load],
  );

  // 제한적 재조회(V2) — 그룹 흐름에 머무는 동안만, 상한까지.
  useEffect(() => {
    if (!flow.inFlow) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      load();
      if (count >= REFETCH_MAX) clearInterval(timer);
    }, REFETCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flow.inFlow, load]);

  const current = queue.length > 0 ? queue[0] : null;
  // slot을 얻은 것만 마운트한다 — 그룹 시트·코치마크와 겹치지 않는 유일한 방법이다.
  const slot = useOverlaySlot(CHALLENGE_RESULT_OVERLAY_ID, {
    priority: OVERLAY_PRIORITY.challengeResult,
    active: current !== null && flow.inFlow,
  });
  const granted = current !== null && flow.inFlow && slot === 'granted';

  // ── D8 순서: slot → 선점(claim) → **활성 claim 재검증** → 노출 → ack ──────────
  // 선점에 성공하고 **그 토큰으로 재검증까지 통과한** 회차만 렌더한다.
  // ⚠️ 재검증이 왜 별도 단계인가(계약 §4 · N53): A가 선점하고 백그라운드로 내려간 사이
  //    lease(2분)가 만료돼 B가 재선점하면, A가 복귀했을 때 **A가 들고 있던 성공 응답은 여전히
  //    ok:true**다. 그것을 믿고 노출하면 두 기기가 같은 결과를 동시에 본다. 그래서 렌더 직전에
  //    현재 토큰을 실어 되묻고, 통과한 응답의 토큰만 저장한다(서버는 같은 토큰을 돌려준다 —
  //    비회전. 회전시키면 갱신 응답 유실이 곧 영구 불일치가 되어 ack까지 막힌다).
  // ⚠️ 그리고 그 재검증조차 **비활성 구간을 건너뛴 응답에는 무의미**하다 — 응답이 오는 사이
  //    JS가 정지했다면 그 뒤 무슨 일이 있었는지 알 수 없다. 활동 세대로 그런 응답을 폐기하고
  //    포그라운드에서 처음부터 다시 검증한다(AppState 이펙트가 claimTick을 올린다).
  // 놓쳤으면(ok:false) 큐에서 빼지 않는다 — 그 기기가 끝까지 못 보고 닫을 수도 있다.
  // ⚠️ ack를 노출 앞에 두면 렌더가 중단됐을 때 **어느 기기에서도 못 본다**(N58 · IA §4.3).
  const currentSessionId = current?.sessionId ?? null;
  useEffect(() => {
    if (!granted || currentSessionId === null) return;
    if (claimRef.current?.sessionId === currentSessionId) return; // 이미 이 회차를 쥐고 있다
    if (claimingRef.current === currentSessionId) return; // 진행 중
    claimingRef.current = currentSessionId;
    const generation = activityGenRef.current;
    let canceled = false;

    const failed = (): ChallengeResultClaim => ({ ok: false, retryAfterMs: null });
    // 선점 → 같은 토큰으로 재검증. 둘 다 통과해야 노출 후보가 된다.
    claimChallengeResult(currentSessionId)
      .catch(failed)
      .then((acquired) => {
        if (canceled || !mountedRef.current) return acquired;
        if (!acquired.ok) return acquired;
        return claimChallengeResult(currentSessionId, acquired.claimToken).catch(failed);
      })
      .then((verified) => {
        if (claimingRef.current === currentSessionId) claimingRef.current = null;
        if (canceled || !mountedRef.current) return;
        // 비활성 구간을 건너뛴 응답 — 폐기하고 **처음부터 다시** 검증한다. 여기서 그냥
        // return만 하면 이 회차는 재시도 계기를 잃는다(진행 중 표시 때문에 복귀 시점의
        // claimTick 증가가 이미 한 번 삼켜졌다).
        if (activityGenRef.current !== generation) {
          setClaimTick((tick) => tick + 1);
          return;
        }
        if (verified.ok) {
          claimFailStreakRef.current = 0;
          setClaim({ sessionId: currentSessionId, token: verified.claimToken });
          return;
        }
        // 상대 지연 뒤 재시도한다. ⚠️ **먼저 서버 큐를 다시 판정한다** — 기다리는 사이 다른
        // 기기가 그 결과를 ack 했을 수 있고, 그러면 이 stale head를 아무리 다시 선점해도
        // RESULT_ALREADY_ACKED만 돌아오며 뒤의 결과까지 영영 막힌다(제한적 재조회 5회가
        // 이미 끝났다면 이 자리가 유일한 갱신 계기다).
        claimFailStreakRef.current += 1;
        const base = verified.retryAfterMs ?? CLAIM_RETRY_FALLBACK_MS;
        // 상한은 두지 않는다 — 늘리는 것은 간격뿐이다(상수 주석 참고).
        const delay =
          claimFailStreakRef.current > CLAIM_BACKOFF_AFTER_FAILURES
            ? base * CLAIM_BACKOFF_FACTOR
            : base;
        const timer = setTimeout(() => {
          if (!mountedRef.current) return;
          loadRef.current().finally(() => {
            if (!mountedRef.current) return;
            setClaimTick((tick) => tick + 1);
          });
        }, delay);
        timersRef.current.push(timer);
      });
    return () => {
      canceled = true;
    };
  }, [granted, currentSessionId, claimTick]);

  const visible = granted && current !== null && claim?.sessionId === current.sessionId;

  // ack 재시도 — **모달을 다시 띄우지 않는다**(N51). 로컬 가드는 노출 시점에 이미 찍혔으므로,
  // 여기서 포기하면 서버에는 영영 미확인으로 남아 다른 기기·재설치에서 다시 뜬다.
  const runAck = useCallback((sessionId: string, token: string, attempt: number) => {
    ackChallengeResult(sessionId, token)
      .catch(() => false)
      .then((done) => {
        if (done || !mountedRef.current || attempt + 1 >= ACK_MAX_ATTEMPTS) return;
        const timer = setTimeout(() => runAck(sessionId, token, attempt + 1), ACK_RETRY_MS);
        timersRef.current.push(timer);
      });
  }, []);

  // 노출 이벤트 + 1회 가드 기록 + **ack 시작** — 모달이 실제로 뜬 순간 결과당 1회.
  // ⚠️ 가드를 닫을 때 기록하면 모달이 떠 있는 사이의 재조회가 같은 결과를 큐에 또 넣는다(계약 D2).
  // ⚠️ ack도 **닫을 때가 아니라 여기서** 시작한다: 사용자가 모달을 본 뒤 닫기 전에 강제 종료·
  //    크래시하면 서버엔 미확인으로 남는데, 로컬 마커는 이미 찍혀 다음 실행에서 후보가 걸러져
  //    ack가 다시 시작될 계기가 없다. D8의 "노출 → ack"는 이 커밋 시점이 곧 노출이다.
  useEffect(() => {
    if (!visible || current === null) return;
    const key = current.sessionId;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    shownAtRef.current = Date.now();
    // 가드 키는 계정 스코프다(IA §8).
    if (userId) markChallengeResultSeen(userId, current.sessionId, current.date);
    // 정산 결과를 보여주는 순간 잔액도 맞춘다(PR #566 리뷰 ⑤) — 큐가 그룹 무관 소스(N53)라
    // 다른 그룹·ENDED 챌린지의 정산은 어느 화면의 서명 비교로도 감지되지 않는다.
    // 중복 호출 무해(서버 재조회)·실패 무해(refreshCoins는 throw 없이 false).
    refreshCoins();
    logGroupChallengeResultShown({
      status: current.status,
      // null(미판정)은 파라미터를 아예 싣지 않는다 — false(미달성)와 뭉개지 않는다.
      achieved: current.myAchieved ?? undefined,
      achiever_count: current.achievers.length,
      member_count: current.memberCount,
    });
    // 노출이 커밋된 **이 순간**이 D8의 마지막 단계다. 토큰은 재검증을 통과한 최신 것이다.
    const token = claimRef.current;
    if (token !== null && token.sessionId === key) runAck(key, token.token, 0);
  }, [visible, current, userId, refreshCoins, runAck]);

  const onClose = useCallback(() => {
    const shownAt = shownAtRef.current;
    shownAtRef.current = null;
    shownKeyRef.current = null;
    if (shownAt !== null) logGroupChallengeResultClosed({ dwell_ms: Date.now() - shownAt });
    // ack는 여기서 시작하지 않는다 — 노출 이펙트가 이미 보냈다(위 ⚠️). 닫기는 큐를 넘길 뿐이다.
    setClaim(null);
    applyQueue(queueRef.current.slice(1));
  }, [applyQueue]);

  if (!visible || current === null) return null;
  // props는 그대로다(계약 D7) — MenuScreen의 dev 미리보기가 같은 시그니처를 쓴다.
  return <ChallengeResultModal result={current} onClose={onClose} />;
}
