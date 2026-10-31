import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { t } from '@/i18n';
import type { FocusFinishView } from '@/services/api/focusSessions';
import { ApiError, uuid } from '@/services/api/client';
import { getMyInventory } from '@/services/api/shop';
import { arriveWithOutcome } from '@/screens/island/Telescope';
import { intentKeyPool } from '@/services/model';
import { getSession, sessionGeneration } from '@/services/api/session';
import { unknownOutcome } from '@/services/islandCommands';
import { getTelescope } from '@/services/api/telescope';
import type { MagazineToday } from '@/services/api/magazine';
import {
  magazineUnread,
  markDelivered,
  sendReceipt,
  wasDelivered,
} from '@/screens/magazine/useMagazineToday';
import type { State } from '@/services/model';
import {
  openSeaRoom,
  seaParticipantsAt,
  type SeaEmoteResult,
  type SeaLiveMember,
  type SeaRoom,
} from '@/services/seaRealtime';
import { SeaScreen } from './SeaScreen';
import {
  SeaNotice,
  type SeaArrival,
  type SeaEmote,
  type SeaParticipant,
  type SeaVoyage,
} from './seaModel';
import { saveSeaRemark, seaRemarkCooldownSeconds } from './seaRemark';

/** 도착 뒤 인벤토리 재조회를 기다리는 최대 시간. */
const INVENTORY_WAIT_MS = 3000;
/** 이모트 표시 수명 — 섬 응원과 같은 3초. */
const EMOTE_TTL_MS = 3000;
/** 이모트가 나가지 못한 이유별 안내(GROMO-2484) — 「연결이 원활하지 않아요」는 연결 문제(끊김·닫힘)에만 쓴다. */
const EMOTE_FAILURE: Record<Exclude<SeaEmoteResult, 'sent'>, string> = {
  'no-room': 'openSea.rejoining',
  disconnected: 'openSea.retry',
  throttled: 'openSea.emoteTooFrequent',
  closed: 'openSea.retry',
};

/** 응답을 잃어 서버가 끝냈는지 모른다(연결 끊김·타임아웃) — 서버가 이미 정산했을 수 있다. */
const finishOutcomeUnknown = (thrown: unknown) =>
  !(thrown instanceof ApiError) || thrown.status === 0 || unknownOutcome(thrown);

/** `seaArrival` 라우트 인자 — 섬에 내린 finish 응답과 목적지 이름(결과창 내용은 GROMO-2311). */
export type SeaArrivalParam = { finish: FocusFinishView; destinationName: string };

const arrivalFrom = (detail: unknown): SeaArrival | null => {
  try {
    const p = JSON.parse(String(detail)) as SeaArrivalParam;
    return {
      recordId: p.finish.recordId,
      destinationId: p.finish.islandId,
      destinationName: p.destinationName,
      activeSeconds: p.finish.activeSeconds,
      rewards: p.finish.seaReward?.grantedProductIds ?? [],
      newRewards: p.finish.seaReward?.newProductIds ?? [],
      minutesToNextTier: p.finish.seaReward?.minutesToNextTier ?? null,
      rewardsUnknown: !p.finish.seaReward,
    };
  } catch {
    return null;
  }
};

/**
 * 바다 항해 집중 화면 호스트(GROMO-2310) — 라우트 `sea`(항해·정박·표류)와 `seaArrival`(섬에 내린 뒤 결과창 자리).
 * 2303 `SeaScreen` 의 공개 props 는 그대로 두고 여기서 세션 정본(`state.session`, kind=sea)·바다 방 STOMP·한마디 API 를 잇는다.
 *
 * - 남은 분·정박은 앱 파생이다: 서버가 준 activeSeconds 를 «받은 시각»부터 기기 시계로 이어 센다(기기·서버 시계 차이를 타지
 *   않아 시계가 빠른 기기가 정박 전에 [섬에 내리기]를 띄워 도착을 잃지 않는다). 정박 = activeSeconds ≥ targetMinutes×60.
 * - 그만두기와 내리기는 같은 `finish` 다. 서버가 `arrived=true` 면(오래된 화면에서 그만두기를 눌렀어도) 결과창으로, 아니면
 *   별도 연출 없이 같은 화면의 표류 상태(`voyage=null`)로 남는다.
 * - 라우트 인자(`e.detail`)는 `sea` 에서는 망원경이 넘긴 목적지 이름, `seaArrival` 에서는 `SeaArrivalParam` JSON 이다.
 * - 오늘 고양이 잡지(GROMO-2314, `e.magazineToday`): 표류 중 아직 받지 않은 오늘 호면 펠리컨이 한 번 알리고(띄우는 순간 받음 SEA),
 *   받은 호(바다·섬 어디서든)는 내 뗏목 옆 물건으로 둔다. 둘 다 `seaMagazine`(인자 = 호 id)으로 펼친다. 꽂이는 바다에 없다.
 */
export function SeaVoyageHost({ e }: { e: any }) {
  const s: State = e.state;
  const selfId = getSession()?.userId ?? 'me';
  const session = s.session?.kind === 'sea' ? s.session : null;
  const now: number = e.now ?? Date.now();
  const [members, setMembers] = useState<SeaLiveMember[]>([]);
  const [emotes, setEmotes] = useState<Record<string, SeaEmote>>({});
  // 이 화면에서 저장한 한마디 — 서버가 확인하기 전까지만 쓰는 임시값. before 는 저장 시점에 서버가 알던 내 한마디,
  // known 은 그 값을 알았는지(방 밖 — 표류 정리 뒤·첫 스냅샷 전이면 몰랐다)
  const [remark, setRemark] = useState<{
    text: string;
    before: string | undefined;
    known: boolean;
  } | null>(null);
  const remarkRef = useRef(remark);
  remarkRef.current = remark;
  // 목록에서 찾은 목적지 이름 — 어느 세션·목적지의 이름인지 같이 들고, 바뀌면 버린다
  const [fetchedName, setFetchedName] = useState<{
    sessionId: string;
    destinationId: string;
    name: string;
  } | null>(null);
  // 라우트 인자(망원경이 넘긴 이름)는 이 화면이 처음 본 세션에만 맞는다
  const firstSessionId = useRef(session?.id);
  // [들어가기] 도착 기록의 Idempotency-Key — 실패해도 같은 섬이면 같은 키로 다시 나간다
  const arriveKeys = useRef(intentKeyPool(uuid)).current;
  const room = useRef<SeaRoom | null>(null);
  const emoteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // 세션 정본 재조회 — 다른 기기에서 항해를 끝냈으면 current 가 비어 SESSION_SYNC 가 세션을 지우고 화면은 표류로 바뀐다.
  // 전환 중이면 명령 계층이 미루므로 실패는 조용히 버린다.
  const resyncing = useRef(false);
  // 결과를 모르는 종료(응답 유실) — 이 세션 id 가 있으면 재조회 전에 같은 키로 finish 를 다시 보낸다.
  // recover() 를 먼저 부르면 current=null 로 세션을 지워 명령 계층이 재시도할 세션·키를 잃는다(→ STATE_CONFLICT, 결과 유실).
  // version 까지 들고 있어 로컬 세션이 지워진 뒤에도 명령 계층이 같은 키를 찾는다.
  // 목적지 이름도 그때 값으로 든다 — 세션이 지워진 뒤 화면 이름은 「목적지」 폴백이다.
  const pendingFinish = useRef<{ id: string; version?: number; name: string } | null>(null);
  // await 뒤에 부르는 e.replace·e.notify 는 최신 e 로 — App 의 e 와 그 함수들은 렌더마다 새로 만든다
  const eRef = useRef(e);
  eRef.current = e;
  // 화면이 아직 이 호스트 자리인가 — 언마운트(뒤로가기 등)면 진행 중이던 요청의 후속 작업을 건너뛴다
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const settleFinish = (finished: FocusFinishView, name: string) => {
    pendingFinish.current = null;
    // 서버가 최종 판정한다 — 이미 도착한 세션이면 그만두기를 눌렀어도 결과창으로 간다
    if (finished.arrived) {
      const param: SeaArrivalParam = { finish: finished, destinationName: name };
      eRef.current.replace('seaArrival', JSON.stringify(param));
    }
  };
  const retryFinish = async () => {
    const pending = pendingFinish.current;
    if (!pending) return;
    try {
      // 명령 계층은 (세션, version) 당 키 하나를 실패해도 들고 있다 — 같은 키라 서버가 최초 정산을 재생한다
      settleFinish(
        await e.focus.finish({ id: pending.id, version: pending.version }),
        pending.name,
      );
    } catch (thrown) {
      if (finishOutcomeUnknown(thrown)) return; // 아직 모른다 — 다음 복귀·재연결에 다시
      pendingFinish.current = null;
      // 세션이 이미 없다(STATE_CONFLICT 등) — 정본을 맞추고 결과는 못 찾았다고 알린다(표류로 남는다)
      await e.focus
        .recover()
        .then(follow)
        .catch(() => {});
      eRef.current.notify(t('openSea.finishUnconfirmed'));
    }
  };
  // 복구 결과가 섬 집중이면(다른 기기가 항해를 끝내고 섬에서 집중 시작) 그 화면으로. 'sea'·null 은 이 화면(항해/표류) 그대로
  const follow = (route: unknown) => {
    if (route === 'focus' || route === 'rest') eRef.current.replace(route);
  };
  // 로컬 세션 유무와 무관하게 정본을 읽는다 — 표류 중에도 다른 기기가 섬 집중·새 항해를 시작했을 수 있다
  const resync = () => {
    // 바다 방이 오류 상한으로 쉬고 있으면 바로 다시 붙는다(참가자·이모트 복구 — 세션 정본과 별개)
    room.current?.reconnect();
    if (!e.focus || resyncing.current) return;
    // finish 는 «지금 세션»을 끝낸다 — 대기 중인 종료가 다른 세션(명령 계층이 복원한 새 항해 등)을 가리키게 됐으면
    // 사용자가 끝내지 않은 세션을 자동 종료하지 않도록 재시도를 버린다. 로컬 세션이 없으면(App 복구가 지웠다) 다른 세션이
    // 아니라 «불명» — 같은 키로 한 번 더 물어 서버가 결과 또는 STATE_CONFLICT 로 답하게 한다
    const current = sessionRef.current;
    if (pendingFinish.current && current && pendingFinish.current.id !== current.id)
      pendingFinish.current = null;
    const work = pendingFinish.current
      ? retryFinish()
      : e.focus
          .recover()
          .then(follow)
          .catch(() => {});
    resyncing.current = true; // 한 번에 하나만 — 연속 사건·복귀가 겹쳐도 조회는 하나
    work.finally(() => {
      resyncing.current = false;
    });
  };
  const onMembers = (next: SeaLiveMember[]) => {
    setMembers(next);
    const me = next.find((m) => m.userId === selfId);
    if (!me) return;
    // 서버가 보는 내 상태와 로컬 세션이 어긋났다 — 다른 기기가 같은 항해를 끝냈거나(adrift) 새로 출항했다(focusing)
    const local = sessionRef.current;
    // 다른 기기가 기존 항해를 끝내고 새로 출항했으면(중간 adrift 를 놓쳐) 둘 다 focusing 이라 세션 id 로만 갈린다
    if (
      me.focusing !== !!local ||
      (me.sessionId !== undefined && local !== null && me.sessionId !== local.id)
    )
      resync();
    // 내 한마디가 서버에서 바뀌어 왔으면(내 저장이 반영됐거나 다른 기기가 고쳤다) 임시값을 버리고 서버 값을 쓴다.
    // 「저장 뒤 N초」로 풀지 않는 이유: 실시간 사건이 꺼진 환경에서는 스냅샷이 한참 옛 값이라 시간으로 풀면 되돌아가 보인다.
    // 저장 시점 값을 몰랐으면(known=false) 늦게 온 옛 값과 다른 기기 값을 가를 수 없다 — 방금 저장한 값이 돌아올 때만 푼다
    // (GROMO-2484: 표류 정리 뒤 재입장 스냅샷이 저장 전 옛 한마디를 싣고 늦게 와 화면을 되돌렸다)
    const pending = remarkRef.current;
    if (
      pending &&
      ((me.message ?? '') === pending.text || (pending.known && me.message !== pending.before))
    )
      setRemark(null);
  };
  // 마운트 때 한 번 건 구독(AppState·바다 방)은 이 ref 로 매 렌더의 최신 콜백을 부른다 — App 의 e 는 렌더마다 새 객체이고
  // e.replace·e.notify 도 렌더마다 새로 만든 함수라, 첫 렌더 클로저를 쓰면 옛 라우트·상태 위에서 움직인다
  const live = useRef({ resync, onMembers, notify: (message: string) => e.notify(message) });
  live.current = { resync, onMembers, notify: (message: string) => e.notify(message) };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') live.current.resync();
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 바다 방 — 화면에 있는 동안만 들어가 있다(목업·서버 세션 없음이면 열지 않는다)
  useEffect(() => {
    if (!e.focus) return;
    const timers = emoteTimers.current;
    const r = openSeaRoom({
      onMembers: (next) => live.current.onMembers(next),
      onEmote: (userId, type) => {
        setEmotes((prev) => ({ ...prev, [userId]: type }));
        clearTimeout(timers.get(userId));
        timers.set(
          userId,
          setTimeout(() => {
            timers.delete(userId);
            setEmotes(({ [userId]: _gone, ...rest }) => rest);
          }, EMOTE_TTL_MS),
        );
      },
      onError: (message) => live.current.notify(message),
      onReconnect: () => live.current.resync(),
    });
    room.current = r;
    return () => {
      room.current = null;
      r.close();
      timers.forEach(clearTimeout);
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 목적지 이름: 서버(T1) → 망원경이 넘긴 이름 → (복구 등으로 둘 다 없으면) 망원경 목록을 한 번 읽어 찾는다 → 「목적지」
  // 다른 기기가 새 목적지로 출항해 세션이 바뀌면 옛 이름을 쓰지 않고 목록을 다시 읽는다.
  const passedName =
    e.route === 'sea' &&
    typeof e.detail === 'string' &&
    !!session &&
    session.id === firstSessionId.current
      ? e.detail
      : '';
  const knownName = session?.destinationIslandName || passedName;
  const cachedName =
    fetchedName &&
    session &&
    fetchedName.sessionId === session.id &&
    fetchedName.destinationId === session.islandId
      ? fetchedName.name
      : '';
  useEffect(() => {
    if (!session || knownName || cachedName || !e.focus) return;
    let live = true;
    const { id: sessionId, islandId: destinationId } = session;
    getTelescope()
      .then((list) => {
        const found = list.items.find((item) => item.islandId === destinationId);
        if (live && found) setFetchedName({ sessionId, destinationId, name: found.name });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.islandId, knownName]);
  const destinationName = knownName || cachedName || t('openSea.destinationFallback');

  const arrival = useMemo(
    () => (e.route === 'seaArrival' ? arrivalFrom(e.detail) : null),
    [e.route, e.detail],
  );

  // 펠리컨은 섬 홈(MagazineHomeLayer)과 같은 규칙 — 실제로 뜬 순간(SeaScreen 의 onShown) 받음(SEA)을 적고, 한 번 알린 호는
  // 받음 기록이 실패해도 이번 실행 동안 다시 띄우지 않는다. 다른 창 때문에 미뤄진 동안은 적지 않고, 그 사이 항해가 시작되거나
  // 다른 곳에서 받았으면 띄울 차례를 거둔다
  const today: MagazineToday | null = e.magazineToday ?? null;
  const issue = today?.issue?.current ? today.issue : null;
  const drifting = e.route === 'sea' && !session;
  // 첫 섬 대기·튜토리얼 진행·완료 이력 복원 중에는 잡지로 첫 흐름을 가로막지 않는다.
  const magazineReady = drifting && (!!s.focusGuideDone || (s.tutorial?.step ?? 0) >= 22);
  const [delivering, setDelivering] = useState<string | null>(null);
  useEffect(() => {
    // 표류가 끝나면(다른 기기의 출항 포함) 이미 뜬 배달도 거둔다 — 다시 표류해도 같은 호는 다시 띄우지 않는다
    if (!magazineReady || !issue) {
      setDelivering(null);
      return;
    }
    if (wasDelivered(issue.issueId)) return;
    setDelivering(today?.receipt ? null : issue.issueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magazineReady, issue?.issueId, today?.receipt]);
  // 운영진의 편지(GROMO-2615) — 배달이 실제로 진행 중인 동안만 App 에 알린다(편지가 떠 있으면 배달이 보류라 알리지 않는다)
  // 항해 결과창(arrival)이 떠 있는 동안도 같은 신호다
  const deliveryActive = (!!delivering && !e.letterOpen) || !!arrival;
  const setSceneGuideOpen = e.setSceneGuideOpen;
  useEffect(() => {
    if (!deliveryActive) return;
    setSceneGuideOpen?.(true);
    return () => setSceneGuideOpen?.(false);
  }, [deliveryActive, setSceneGuideOpen]);
  const deliveryShown = () => {
    if (!magazineReady || !delivering || wasDelivered(delivering)) return;
    markDelivered(delivering);
    sendReceipt(delivering, { place: 'SEA' }).catch(() => {});
  };
  const readLater = () => {
    if (!magazineReady) return;
    setDelivering(null);
    if (delivering) sendReceipt(delivering, { place: 'SEA', deferred: true }).catch(() => {});
  };

  // App 공용 뒤로가기(backOverride) — 라우트 수명 내내 건다. App 의 BackHandler 가 SeaScreen 의 것보다 늦게 등록돼
  // 먼저 불리는 창에서도 항해 중 back() 이 홈으로 가 세션을 남기지 않게 한다. 둘 중 먼저 불린 쪽이 true 를 돌려주면
  // 나머지는 불리지 않아 이중 처리가 없다. 항해 확인 패널은 2303 공개 props 로 열 수 없어 안내만 하고 삼킨다.
  const onBack = useRef<() => boolean>(() => false);
  onBack.current = () => {
    if (session && !arrival) {
      e.notify(t('openSea.backBlocked'));
      return true;
    }
    // 떠 있는 펠리컨 배달 — SeaScreen 보다 App 의 뒤로가기가 먼저 불려도 「나중에 읽기」와 같게
    if (magazineReady && delivering && wasDelivered(delivering)) {
      readLater();
      return true;
    }
    return false; // 표류·결과창 — App 기본 뒤로가기
  };
  useEffect(() => {
    if (!e.backOverride) return;
    const handler = () => onBack.current();
    e.backOverride.current = handler;
    return () => {
      if (e.backOverride.current === handler) e.backOverride.current = null;
    };
  }, [e.backOverride]);

  let voyage: SeaVoyage | null = null;
  if (session) {
    // 기준점은 세션을 받은 기기 시각(syncedAt) — 세션과 함께 저장돼 화면을 나갔다 와도 경과가 되돌아가지 않는다.
    // 없으면(옛 저장본) 서버 시각 기준점(startedAt = serverNow)으로 센다.
    const since = session.syncedAt ?? session.startedAt;
    const activeSeconds = session.seconds + Math.max(0, Math.floor((now - since) / 1000));
    const requiredSeconds = (session.targetMinutes ?? 0) * 60;
    voyage = {
      sessionId: session.id,
      destinationId: session.islandId,
      destinationName,
      subject: '',
      activeSeconds,
      requiredSeconds,
      canDisembark: session.targetMinutes != null && activeSeconds >= requiredSeconds,
    };
  }

  const withEmote = (p: SeaParticipant): SeaParticipant =>
    emotes[p.userId] ? { ...p, emote: emotes[p.userId] } : p;
  const mine = members.find((m) => m.userId === selfId);
  const message = remark
    ? remark.text
    : (mine?.message ?? (e.focusBlockingIntroPreview ? session?.subject : undefined));
  const self = withEmote({
    userId: selfId,
    name: s.name,
    color: s.color,
    focusing: !!voyage,
    outfit: {
      head: s.equipped?.head ?? null,
      neck: s.equipped?.neck ?? null,
      shoes: s.equipped?.shoes ?? null,
    },
    activeSeconds: mine?.activeSeconds ?? 0,
    ...(message ? { message } : {}),
  });

  return (
    <SeaScreen
      self={self}
      participants={seaParticipantsAt(members, now).map(withEmote)}
      voyage={arrival ? null : voyage}
      result={arrival}
      messageCooldownSeconds={seaRemarkCooldownSeconds(now)}
      onFinish={async (sessionId) => {
        if (!session || session.id !== sessionId) throw new Error('stale voyage');
        if (e.focusBlockingIntroPreview && !e.focus) {
          e.dispatch({ type: 'SESSION_SYNC', session: null });
          return;
        }
        if (!e.focus) throw new Error('stale voyage');
        const name = destinationName;
        let finished: FocusFinishView;
        try {
          finished = await e.focus.finish();
        } catch (thrown) {
          if (finishOutcomeUnknown(thrown)) {
            pendingFinish.current = { id: sessionId, version: session.version, name };
            e.notify(t('openSea.finishChecking'));
          } else pendingFinish.current = null; // 확정 실패(STATE_CONFLICT 등) — 대기 중이던 재시도도 끝
          throw thrown; // SeaScreen 이 다시 시도 안내를 띄운다 — 다시 누르면 같은 키로 간다
        }
        settleFinish(finished, name);
      }}
      onExplore={async (result) => {
        if (!e.islands) return e.home(); // 목업 — 서버 섬이 없다
        const id = result.destinationId;
        // 요청 시작 때 잡은 세대 — await 뒤마다 화면·로그인 세대가 바뀌었으면 dispatch·이동을 하지 않는다
        const generation = sessionGeneration();
        const stale = () =>
          !mounted.current ||
          eRef.current.route !== 'seaArrival' ||
          sessionGeneration() !== generation;
        // 던지면 SeaScreen 이 다시 시도 안내를 띄운다 — 결과 불명은 arrive 가 소속 재조회로 가린다
        const { member, arrivedBefore } = await arriveWithOutcome(e, arriveKeys, id);
        if (stale()) return;
        // 받은 꾸미기를 옷장에서 바로 입도록 인벤토리를 읽고 나서 이동한다 — 이동 뒤에 늦게 적용되면 그 사이 장착을 되돌린다.
        // 실패·시간 초과(3초)면 읽지 않고 이동하며, 늦은 응답은 버린다(옷장이 다음 진입 때 다시 읽는다).
        await new Promise<void>((done) => {
          let open = true;
          const timer = setTimeout(() => {
            open = false;
            done();
          }, INVENTORY_WAIT_MS);
          getMyInventory()
            .then((myInventory) => {
              if (open && !stale())
                eRef.current.dispatch({ type: 'SHOP_SYNC', islandId: id, myInventory });
            })
            .catch(() => {})
            .finally(() => {
              open = false;
              clearTimeout(timer);
              done();
            });
        });
        if (stale()) return;
        // await 뒤에는 최신 e 로 부른다(App 의 e 와 그 함수들은 렌더마다 새로 만든다)
        if (member) {
          // 현 가입 이후 첫 도착이면 환영을 한 번 — 서버가 arrivedBefore=false 로 알려 준다
          if (!arrivedBefore)
            eRef.current.notify(
              `${t('openSea.welcomeTitle')} ${t('openSea.welcomeBody', { island: result.destinationName })}`,
            );
          eRef.current.reset('home');
        } else {
          await eRef.current.islands.visit(id);
          if (stale()) return;
          eRef.current.dispatch({ type: 'SERVER_VISITING', islandId: id });
          eRef.current.replace('visitIsland', id);
        }
      }}
      onTelescope={async () => {
        const generation = sessionGeneration();
        // 부팅 중 소속 조회가 실패해도 바다에 머문다. 망원경을 누르면 소속·저장소 복구부터 재시도한다.
        if (e.islandBootError && e.islands) await e.islands.sync();
        if (mounted.current && sessionGeneration() === generation) eRef.current.go('telescope');
      }}
      magazine={
        magazineReady && issue
          ? {
              issueNo: issue.issueNo,
              // 운영진의 편지가 떠 있는 동안은 배달을 시작하지 않는다(받음 처리도 미룬다)
              delivery: delivering === issue.issueId && !e.letterOpen,
              received: !!today?.receipt,
              unread: magazineUnread(today),
              onShown: deliveryShown,
              onOpen: () => {
                setDelivering(null);
                e.go('seaMagazine', issue.issueId);
              },
              onLater: readLater,
            }
          : null
      }
      // 표류 중 위쪽 HUD(GROMO-2404) — 친구 요청 수는 홈(WorldMap)과 같은 출처: 서버면 친구 화면 상태, 목업이면 로컬 친구
      hud={
        drifting
          ? {
              requests: e.islands
                ? e.friendsScreen?.status === 'ready'
                  ? (e.friendsScreen.data?.friendRequests.length ?? 0)
                  : 0
                : (s.friends ?? []).filter((f) => f.status === 'received').length,
              go: e.go,
            }
          : null
      }
      onMessage={async (text) => {
        if (!(await saveSeaRemark(e, text))) return;
        setRemark({ text, before: mine?.message, known: !!mine });
        // 표류 정리(adrift)로 방에서 빠졌으면 저장 «뒤» 다시 들어간다 — 한마디는 REST 라 입장이 필요 없고,
        // 저장 뒤 입장해야 그 스냅샷이 새 한마디를 싣는다. 방에 있어야 남에게 보인다
        room.current?.reconnect();
      }}
      onEmote={async (type) => {
        const sent = room.current?.sendEmote(type) ?? 'closed';
        if (sent !== 'sent') throw new SeaNotice(t(EMOTE_FAILURE[sent]));
      }}
    />
  );
}
