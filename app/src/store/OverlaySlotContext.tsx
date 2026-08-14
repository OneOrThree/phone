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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
}

// 두 컨텍스트로 나눈 이유: 동작(request/release)은 **신원이 고정**돼야 한다. 보유자와 한 객체로
// 묶으면 보유자가 바뀔 때마다 컨텍스트 값이 갈리고, 등록 이펙트가 통째로 재실행되며
// release → request 를 반복해 방금 준 slot을 스스로 흔든다.
const OverlaySlotActionsContext = createContext<OverlaySlotActions | null>(null);

interface OverlaySlotState {
  holderId: string | null;
  // 지금 등록돼 있는 요청 중 가장 높은 우선순위(없으면 -1). 보유자가 **스스로 물러날지**를
  // 판단하는 소비자가 읽는다 — 조정자는 뺏지 않지만, 소비자가 자기 도메인 규칙으로 양보하는
  // 것까지 막지는 않는다(그룹 덱 코치마크가 사용자 시트에 자리를 내주는 경우).
  maxPriority: number;
}

const EMPTY_STATE: OverlaySlotState = { holderId: null, maxPriority: -1 };

const OverlaySlotStateContext = createContext<OverlaySlotState>(EMPTY_STATE);

export function OverlaySlotProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, OverlaySlotRegistration>>(new Map());
  const seqRef = useRef(0);
  // 보유자는 렌더에 쓰이므로 state이고, 판정은 이펙트 안에서 즉시 이뤄지므로 ref 사본도 둔다.
  const stateRef = useRef<OverlaySlotState>(EMPTY_STATE);
  const [state, setState] = useState<OverlaySlotState>(EMPTY_STATE);

  const mountedRef = useRef(true);
  const scheduledRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
    const next = { holderId: nextHolder, maxPriority };
    stateRef.current = next;
    setState(next);
  }, []);

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
      settle();
    },
    [settle],
  );

  const release = useCallback(
    (id: string) => {
      if (!registryRef.current.delete(id)) return;
      settle();
    },
    [settle],
  );

  const actions = useMemo<OverlaySlotActions>(() => ({ request, release }), [request, release]);

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

  useEffect(() => {
    if (actions === null || !active) return;
    actions.request(id, priority);
    return () => actions.release(id);
  }, [actions, id, priority, active]);

  if (!active) return 'idle';
  if (actions === null) return 'granted';
  return holderId === id ? 'granted' : 'pending';
}

/**
 * 자기는 무조건 렌더하지만 **다른 전면 오버레이를 막아야 하는** UI(사용자가 방금 연 시트)용.
 * 반환값이 없다 — 상태를 보고 렌더를 가르지 않기 때문이다(OVERLAY_PRIORITY.sheet 주석).
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
export function useOverlayMaxPriority(): number {
  return useContext(OverlaySlotStateContext).maxPriority;
}
