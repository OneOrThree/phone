// 전면 오버레이 조정자 — 정본 docs/prd/group/features/02-my-groups/low-level-design.md §"blocking
// overlay queue" · docs/prd/challenge/policy.md D3.
//
// ── 왜 "그리는 호스트"가 아니라 "허가를 주는 조정자"인가 ──────────────────────────────
// 앱의 전면 오버레이(챌린지 결과 모달 · 그룹 덱 코치마크 · 각종 SheetShell asModal)는 전부 RN
// `Modal`이다. RN Modal은 **별도 네이티브 윈도**에 뜨므로, 루트에 컴포넌트를 하나 두고 그 안에
// 모두 그리는 방식으로는 겹침을 막을 수 없다 — 루트 배너가 Modal 아래로 깔리는 것과 같은 이유다
// (components/Toast.tsx 헤더 주석: "토스트를 Modal로 감싸는 안은 배제했다").
// 그래서 이 모듈은 **그리지 않는다**. 누가 자기 Modal을 마운트해도 되는지 허가(slot)만 준다:
//
//   const status = useOverlaySlot(id, { priority, active });   // 'granted' | 'pending' | 'idle'
//   if (status === 'granted') return <Modal .../>;             // 승인받은 쪽만 마운트한다
//
// 승인받은 하나만 실제로 마운트되므로 겹침이 원천적으로 생기지 않는다. "렌더는 되고 가려진다"가
// 아니라 **마운트 자체가 없다**는 것이 이 설계의 핵심이다.
//
// ── 우선순위: 결과 모달 > 그룹 덱 코치마크 ────────────────────────────────────────
// 결과 모달은 **돈이 오간 사실의 통지**다(정산·환불·몰수 — IA §4.3). 놓치면 사용자는 "내 코인
// 어디 갔지"가 되고, 서버 큐에서 빠지면 되돌릴 경로가 없다. 코치마크는 재노출이 가능하다 —
// groupDeckGuide의 `guideQueued`가 이미 "slot을 못 얻으면 큐에 남았다가 다음에 다시"를 설계해
// 두었다(interruptGuide → setGuideQueued). 그래서 결과가 먼저다.
//
// ── 이미 granted 인 요청은 뺏기지 않는다 ─────────────────────────────────────────
// 더 높은 우선순위가 나중에 등록돼도 현재 보유자를 밀어내지 않는다. 사용자가 **지금 보고 있는
// 것**을 화면에서 걷어내는 것은 어떤 우선순위로도 정당화되지 않는다(읽던 결과가 사라지거나,
// 코치마크가 한 스텝만 보이고 증발한다). 새 요청은 보유자가 스스로 내려놓을 때까지 기다린다.
//
// ── 시트를 새로 추가할 때: **"여는 시점이 동기인가"로 갈린다** ────────────────────
// 여기가 그 판단을 적어 두는 자리다. 전면 오버레이(RN Modal)를 새로 만들면 둘 중 하나를 고른다.
//
// ⚠️ 축은 "누가 열었는가"가 **아니다.** 한때 그렇게 적어 뒀다가 한 경우를 통째로 놓쳤다 —
//    `ChallengeCard.openWeekSheet()`처럼 **탭 → 비동기 조회 → 그 응답으로 시트를 여는** 경로다.
//    사용자가 탭한 것은 맞지만 **여는 시점은 응답이 정한다.** 그 사이에 다른 오버레이가 slot을
//    가져갈 수 있으므로, "사용자가 눌렀으니 안전하다"는 판단이 성립하지 않는다.
//
//   A. **탭과 마운트 사이에 await가 없다**(동기) → `useOverlayBlocker(id, open)`.
//      등록만 하고 승인은 기다리지 않는다. 전면 모달이 떠 있으면 그 버튼을 누를 수 없으므로
//      "이미 뜬 오버레이 위에 이게 열린다"가 성립하지 않는다.
//      예: 그룹 찾기 시트 · 내기/챌린지 만들기 시트 · 카드의 지난 결과 시트.
//
//   B. **탭과 마운트 사이에 await가 있다**(비동기), 또는 아예 터치 없이 열린다
//      → `useOverlaySlot(...) === 'granted'` 일 때만 마운트한다.
//      이미 보유자가 있는 순간에도 열리는 시점이 올 수 있고, 조정자는 보유자를 뺏지 않으므로
//      그냥 렌더하면 **RN Modal 두 개가 겹친다.** 그러면 뒤에 깔린 결과 모달이
//      **가려진 채 seen/ack** 되어 사용자는 한 번도 못 봤는데 서버는 봤다고 기록한다 —
//      이 조정자를 만든 이유가 통째로 무너지는 자리다.
//      예: 초대 프리뷰(딥링크 리스너) · 그룹 생성 완료 다이얼로그(생성 응답) ·
//          주간 예약 시트/진행 중 삭제 시트(프리플라이트 조회 응답).
//      승인을 기다리는 동안 사라지지 않게, 여는 쪽 상태·버퍼는 그대로 유지해야 한다.
//
// 헷갈리면 B를 고른다 — B가 틀렸을 때의 대가는 "한 박자 늦게 뜬다"이고,
// A가 틀렸을 때의 대가는 "사용자가 못 본 통지가 확인 처리된다"이다.
//
// ── 그리고 소비자 쪽에도 안전망이 하나 있다 ─────────────────────────────────────
// 위 판단은 사람이 하는 것이라 언제든 틀릴 수 있다. 그래서 챌린지 결과 모달(가장 잃을 것이 큰
// 소비자)은 **아직 노출 전이면 sheet 우선순위 요청에 스스로 물러난다** — A로 잘못 분류된 시트가
// 나중에 뜨더라도 그 아래에서 seen/ack이 찍히지 않는다. 자세한 것은 ChallengeResultHost의
// `yieldsSlot` 주석.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type OverlaySlotStatus = 'granted' | 'pending' | 'idle';

// 우선순위 축 — 숫자가 클수록 먼저 slot을 얻는다.
//
// sheet: 사용자가 **방금 손으로 연** 시트(내기·챌린지 만들기·카드 시트·그룹 찾기·초대 프리뷰).
//        이들은 status를 보지 않고 항상 렌더한다(useOverlayBlocker) — 등록의 목적은 자기가
//        뜨는 것이 아니라 **그 위에 다른 전면 오버레이가 마운트되는 것을 막는 것**이다.
//        결과 모달이 이미 떠 있는 동안에는 그 뒤의 화면을 누를 수 없어 시트가 새로 열리지
//        않으므로, 이 "무조건 렌더"가 겹침을 만들지 않는다.
export const OVERLAY_PRIORITY = {
  sheet: 300,
  challengeResult: 200,
  groupDeckGuide: 100,
} as const;

interface OverlaySlotRegistration {
  id: string;
  priority: number;
  // 같은 우선순위끼리는 먼저 등록한 쪽이 이긴다 — 등록 순서를 기록해 판정을 결정적으로 만든다.
  seq: number;
}

interface OverlaySlotActions {
  request: (id: string, priority: number) => void;
  release: (id: string) => void;
  /**
   * 요청하고 **승인될 때까지 기다린다**. `false`면 승인 전에 요청이 접혔다는 뜻이다(언마운트 등).
   *
   * ⚠️ `await` 뒤에 여는 오버레이(실패 Alert · 공유 시트)는 이것을 써야 한다. 그 자리는 여는
   *    시점을 응답이 정하므로, 기다리는 사이 결과 모달이 먼저 노출될 수 있고 그러면 우리가
   *    그 **위를** 덮는다 — 사용자는 못 봤는데 seen/ack은 이미 찍힌 상태가 된다.
   */
  acquire: (id: string, priority: number) => Promise<boolean>;
}

// 두 컨텍스트로 나눈 이유: 동작(request/release)은 **신원이 고정**돼야 한다. 보유자와 한 객체로
// 묶으면 보유자가 바뀔 때마다 컨텍스트 값이 갈리고, 등록 이펙트가 통째로 재실행되며
// release → request 를 반복해 방금 준 slot을 스스로 흔든다.
const OverlaySlotActionsContext = createContext<OverlaySlotActions | null>(null);

interface OverlaySlotState {
  holderId: string | null;
  // 지금 이 순간 등록돼 있는 최고 우선순위를 **동기로** 읽는다(아래 maxPriority는 커밋된 값).
  liveMaxPriority: () => number;
  // 지금 등록돼 있는 요청 중 가장 높은 우선순위(없으면 -1). 보유자가 **스스로 물러날지**를
  // 판단하는 소비자가 읽는다 — 조정자는 뺏지 않지만, 소비자가 자기 도메인 규칙으로 양보하는
  // 것까지 막지는 않는다(그룹 덱 코치마크가 사용자 시트에 자리를 내주는 경우).
  maxPriority: number;
}

const EMPTY_STATE: OverlaySlotState = {
  holderId: null,
  liveMaxPriority: () => -1,
  maxPriority: -1,
};

const OverlaySlotStateContext = createContext<OverlaySlotState>(EMPTY_STATE);

export function OverlaySlotProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, OverlaySlotRegistration>>(new Map());
  // 등록 즉시(동기) 갱신되는 최고 우선순위 — state는 마이크로태스크 뒤에 따라온다.
  // 양보 판단(결과 호스트의 `yieldsSlot`)은 **이 값**을 봐야 한 박자도 늦지 않는다.
  const liveMaxPriorityRef = useRef(-1);
  // 승인을 기다리는 명령형 요청들 — 보유자가 되면 true로, 요청이 접히면 false로 깨운다.
  const acquireWaitersRef = useRef<{ id: string; resolve: (granted: boolean) => void }[]>([]);
  const settleAcquireWaiters = useCallback((id: string, granted: boolean) => {
    const waiters = acquireWaitersRef.current;
    const matched = waiters.filter((waiter) => waiter.id === id);
    if (matched.length === 0) return;
    acquireWaitersRef.current = waiters.filter((waiter) => waiter.id !== id);
    matched.forEach((waiter) => waiter.resolve(granted));
  }, []);
  const seqRef = useRef(0);
  // 보유자는 렌더에 쓰이므로 state이고, 판정은 이펙트 안에서 즉시 이뤄지므로 ref 사본도 둔다.
  // ⚠️ 초기값에도 **살아 있는 값을 읽는 함수**를 심는다. 기본 EMPTY_STATE의 것은 항상 -1이라,
  //    첫 판정이 돌기 전에 명령형으로 잡은 자리를 못 읽는다(그게 바로 이 훅이 막으려는 창이다).
  const initialState = useRef<OverlaySlotState>({
    holderId: null,
    liveMaxPriority: () => liveMaxPriorityRef.current,
    maxPriority: -1,
  }).current;
  const stateRef = useRef<OverlaySlotState>(initialState);
  const [state, setState] = useState<OverlaySlotState>(initialState);

  const mountedRef = useRef(true);
  const scheduledRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const readLiveMaxPriority = useCallback(() => liveMaxPriorityRef.current, []);

  const resolveSlot = useCallback(() => {
    const entries = Array.from(registryRef.current.values());
    const holder = stateRef.current.holderId;
    let maxPriority = -1;
    let best: OverlaySlotRegistration | null = null;
    let holderAlive = false;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.priority > maxPriority) maxPriority = entry.priority;
      if (entry.id === holder) holderAlive = true;
      if (
        best === null ||
        entry.priority > best.priority ||
        (entry.priority === best.priority && entry.seq < best.seq)
      ) {
        best = entry;
      }
    }
    // 선점 유지 — 보유자가 아직 살아 있으면 누가 와도 바꾸지 않는다(파일 헤더 주석).
    const nextHolder = holderAlive ? holder : best === null ? null : best.id;
    if (stateRef.current.holderId === nextHolder && stateRef.current.maxPriority === maxPriority) {
      return;
    }
    const next = { holderId: nextHolder, maxPriority, liveMaxPriority: readLiveMaxPriority };
    stateRef.current = next;
    setState(next);
    if (nextHolder !== null) settleAcquireWaiters(nextHolder, true);
  }, [readLiveMaxPriority, settleAcquireWaiters]);

  // ⚠️ 판정은 **한 커밋의 등록을 모두 모은 뒤** 한 번만 한다(마이크로태스크로 미룬다).
  //    등록은 각 소비자의 이펙트에서 일어나고 이펙트는 트리 순서대로 도는데, 등록될 때마다
  //    즉시 판정하면 **먼저 이펙트가 돈 쪽이 보유자로 확정**되고, 선점 유지 규칙이 그 자리를
  //    지켜 준다 — 결과적으로 "우선순위"가 아니라 "트리에서 위에 있는가"가 승부를 가른다.
  //    코치마크는 판정이 로컬 저장소 한 번이고 결과 모달은 네트워크라, 그대로 두면 우선순위가
  //    사문화된다. 미루면 같은 커밋의 요청들이 우선순위로 겨루고, 이전 커밋에서 이미 승인된
  //    보유자는 그대로 지켜진다(선점 금지).
  const settle = useCallback(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    Promise.resolve().then(() => {
      scheduledRef.current = false;
      if (!mountedRef.current) return;
      resolveSlot();
    });
  }, [resolveSlot]);

  const request = useCallback(
    (id: string, priority: number) => {
      const previous = registryRef.current.get(id);
      // 같은 id의 재등록(우선순위만 바뀐 경우)은 등록 순서를 보존한다 — 재등록으로 순번이
      // 뒤로 밀리면 같은 우선순위 경쟁에서 이유 없이 진다.
      registryRef.current.set(id, { id, priority, seq: previous?.seq ?? ++seqRef.current });
      if (priority > liveMaxPriorityRef.current) liveMaxPriorityRef.current = priority;
      settle();
    },
    [settle],
  );

  const release = useCallback(
    (id: string) => {
      // 승인 전에 접힌 요청은 기다리던 쪽에 그 사실을 알린다 — 안 그러면 영원히 매달린다.
      settleAcquireWaiters(id, false);
      if (!registryRef.current.delete(id)) return;
      liveMaxPriorityRef.current = Array.from(registryRef.current.values()).reduce(
        (max, entry) => (entry.priority > max ? entry.priority : max),
        -1,
      );
      settle();
    },
    [settle, settleAcquireWaiters],
  );

  const acquire = useCallback(
    (id: string, priority: number) => {
      request(id, priority);
      if (stateRef.current.holderId === id) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        acquireWaitersRef.current.push({ id, resolve });
      });
    },
    [request],
  );

  const actions = useMemo<OverlaySlotActions>(
    () => ({ request, release, acquire }),
    [request, release, acquire],
  );

  return (
    <OverlaySlotActionsContext.Provider value={actions}>
      <OverlaySlotStateContext.Provider value={state}>{children}</OverlaySlotStateContext.Provider>
    </OverlaySlotActionsContext.Provider>
  );
}

/**
 * 전면 오버레이 slot을 요청한다.
 *
 * - `idle`    : 요청하지 않았다(active=false).
 * - `pending` : 요청했지만 다른 오버레이가 slot을 쥐고 있다. **마운트하면 안 된다.**
 * - `granted` : 지금 마운트해도 되는 유일한 오버레이다.
 *
 * Provider가 없으면(단위 테스트에서 화면 하나만 렌더하는 경우 등) 조정자 자체가 없는 것이므로
 * 경쟁 상대도 없다 — active인 요청을 그대로 `granted`로 돌려준다. 프로덕션 트리에는 App.tsx가
 * 루트에 Provider를 세워 두므로 이 폴백이 실서비스에서 쓰이는 경로는 없다.
 */
export function useOverlaySlot(
  id: string,
  { priority, active }: { priority: number; active: boolean },
): OverlaySlotStatus {
  const actions = useContext(OverlaySlotActionsContext);
  const { holderId } = useContext(OverlaySlotStateContext);

  // ⚠️ **passive effect가 아니라 layout effect다.** RN Modal은 커밋 때 이미 네이티브에 붙는데,
  //    passive effect는 그 **뒤에**(paint 이후) 돈다. 그 창에서 결과 호스트가 claim을 끝내면
  //    "아직 아무도 자리를 요구하지 않았다"고 보고 모달을 **같이** 마운트한다.
  //    layout effect는 같은 커밋 안에서 paint 전에 돌아 그 창을 닫는다.
  //    (그래도 **같은 커밋에서 호스트가 먼저 렌더된 경우**는 남는다 — 파일 하단 한계 주석.)
  useLayoutEffect(() => {
    if (actions === null || !active) return;
    actions.request(id, priority);
    return () => actions.release(id);
  }, [actions, id, priority, active]);

  if (!active) return 'idle';
  if (actions === null) return 'granted';
  return holderId === id ? 'granted' : 'pending';
}

/**
 * 조정자에 **명령형으로** 자리를 요청·반납한다.
 *
 * 선언형(`useOverlaySlot`)은 상태가 바뀌고 → 렌더 → layout effect 순서라, **오버레이를 여는
 * 그 호출 안에서** 자리를 먼저 잡아야 하는 것(네이티브 `Alert.alert` · `Share.share`)에는 늦다.
 * 그런 자리는 이 훅으로 **여는 줄 바로 앞에서** 잡고, 닫히는 자리에서 반납한다.
 * ⚠️ 반납을 빠뜨리면 자리가 영영 잠긴다 — `try/finally`나 모든 종료 콜백에서 부른다.
 */
export function useOverlaySlotActions(): OverlaySlotActions | null {
  return useContext(OverlaySlotActionsContext);
}

/**
 * **여는 이벤트에서 먼저 자리를 잡는다.**
 *
 * ⚠️ 선언형 등록(`useOverlaySlot`의 layout effect)만으로는 한 창이 남는다: `active`가 참이 된
 *    렌더의 **커밋에서 RN Modal은 이미 마운트**되고, 등록은 그 뒤다. 사용자의 시트 열기와
 *    결과 claim 완료가 **같은 React 배치**에 들어가면 호스트는 아직 없는 blocker를 못 보고
 *    결과 모달을 함께 커밋하며 seen/ack까지 남긴다.
 *    그래서 시트를 여는 그 이벤트(= setState를 부르는 자리)에서 이것을 먼저 부른다.
 *    선언형 등록은 그대로 두어도 된다 — 같은 id의 재등록은 순번을 보존하는 no-op이고,
 *    **반납은 여전히 선언형 쪽 정리(cleanup)가 책임진다.**
 */
export function useOverlayPreclaim(id: string): () => void {
  const actions = useContext(OverlaySlotActionsContext);
  return useCallback(() => {
    actions?.request(id, OVERLAY_PRIORITY.sheet);
  }, [actions, id]);
}

/**
 * 자기는 무조건 렌더하지만 **다른 전면 오버레이를 막아야 하는** UI(사용자가 방금 연 시트)용.
 * 반환값이 없다 — 상태를 보고 렌더를 가르지 않기 때문이다(OVERLAY_PRIORITY.sheet 주석).
 * ⚠️ **여는 이벤트에서 `useOverlayPreclaim`을 함께 부르라** — 이유는 그 훅 주석.
 */
export function useOverlayBlocker(id: string, active: boolean): void {
  useOverlaySlot(id, { priority: OVERLAY_PRIORITY.sheet, active });
}

/** 지금 slot을 쥐고 있는 오버레이의 id — "나 말고 누가 떠 있는가"를 묻는 쪽이 쓴다. */
export function useOverlaySlotHolder(): string | null {
  return useContext(OverlaySlotStateContext).holderId;
}

/**
 * 지금 등록된 요청 중 가장 높은 우선순위(아무도 없으면 -1).
 *
 * 조정자는 보유자를 **뺏지 않는다.** 하지만 소비자가 자기 도메인 규칙으로 양보하는 것은 별개다 —
 * 이 값은 그 판단의 재료다. 지금 이것을 읽는 곳은 그룹 덱 코치마크 하나이고, 규칙은
 * "사용자가 방금 연 시트에는 물러난다(다시 큐에 남는다)"이다.
 */
/**
 * 지금 이 순간 등록된 최고 우선순위를 **렌더와 무관하게** 읽는 함수를 돌려준다.
 * 명령형 경로(네이티브 Alert·공유 시트)가 "자리를 잡았는가"를 그 자리에서 확인할 때 쓴다.
 */
export function useOverlayLiveMaxPriority(): () => number {
  return useContext(OverlaySlotStateContext).liveMaxPriority;
}

export function useOverlayMaxPriority(): number {
  const { maxPriority, liveMaxPriority } = useContext(OverlaySlotStateContext);
  // ⚠️ state와 **살아 있는 값** 중 큰 쪽을 쓴다. state는 마이크로태스크 뒤에 따라오므로,
  //    그것만 보면 "자리를 요구한 오버레이가 이미 붙었는데 아직 안 보이는" 창이 생긴다.
  //    그 창에서 결과 모달이 아래에 함께 마운트되는 것이 이 배치의 반복된 실패 모드다.
  return Math.max(maxPriority, liveMaxPriority());
}
