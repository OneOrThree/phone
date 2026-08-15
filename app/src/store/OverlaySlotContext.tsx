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
// ── 자리를 **놓을 때**의 축은 따로 있다: "닫힘이 배경 이벤트로도 일어나는가" ──────
// 위 A/B는 **여는 쪽**의 판단이다. 자리를 놓는 쪽에는 별개의 결함 부류가 있고, 이 배치에서
// 여섯 번 나왔다. 그 부류가 사는 곳은 둘의 곱이다:
//
//   ① 자리를 쥔 주체가 **네이티브 표면**(Alert · 공유 시트 · OS 시트)이라 React 생명주기 밖에
//      있다 — 화면이 사라져도 그 표면은 사용자 앞에 남는다.
//   ② 그 자리를 놓는 계기가 **사용자 조작 말고 배경 이벤트로도** 일어난다 — 배경 재조회로
//      카드가 목록에서 빠지거나, 푸시·딥링크로 화면이 blur되는 것.
//
// ⚠️ **"명령형(request/release/acquire)이냐 선언형(useOverlaySlot)이냐"는 그 자체로 기준이
//    아니다.** 한때 그렇게 적어 뒀다가 세 자리를 놓쳤다. 선언형이라도 ②가 참이면 같은 결함이
//    난다 — 카드가 `deletePreview`로 세운 등록 위에 raw Alert를 얹은 자리가 정확히 그랬다.
//    반대 방향의 대조도 있다: GroupCreateScreen의 완료 다이얼로그는 이미 쥔 자리 안에서
//    네이티브 공유 시트를 여는 **명령형** 경로지만 **안전하다** — 그 다이얼로그는 사용자가
//    버튼을 눌러야만 닫히고 beforeRemove가 이탈까지 막아 ②가 거짓이기 때문이다.
//
// ①②가 모두 참인 자리에서는 정리(cleanup)가 **두 축을 갈라야** 한다:
//   · **승인 대기 중인 요청** → 화면이 사라지면 취소한다(떠난 화면의 오버레이가 새 화면 위로
//     뜨지 않게).
//   · **이미 표시된 네이티브 표면이 쥔 자리** → 유지한다. 반납 주체는 화면이 아니라 그 표면
//     자신이고, 표면이 닫힐 때 미뤄 둔 정리를 실행한다.
// 영구 점유가 되지 않는 근거는 매번 같다 — 네이티브 표면은 **사용자가 닫아야만** 사라지므로
// 닫힘 콜백이 반드시 온다(그래서 버튼과 `onDismiss`를 항상 잇는다).
// 실물: useOverlayAlert(openCount/pendingCancels) · ChallengeCard(alertOverCardSlot) ·
//       GroupRoomScreen·GroupScreen(shareSheetOpenRef).
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

// ── React 밖에서 자리를 쥐는 통로 ─────────────────────────────────────────────
// 네이티브 Alert를 띄우는 것이 컴포넌트만은 아니다 — `services/sessionErrors.ts`의
// `promptSessionExpired`는 **모듈 함수**라 훅을 쓸 수 없는데, 그 Alert도 화면 위에 떠서
// 결과 모달을 가린다(위 "자리를 놓을 때의 축" 절의 ①이 참인 표면이다).
// 그래서 Provider가 마운트돼 있는 동안 자기 actions를 여기 걸어 둔다.
// ⚠️ Provider 밖(로그인 전 트리 등)에서는 null이다 — 호출부는 그때 종전대로 그냥 띄운다.
//    경쟁 상대가 존재할 수 없으므로 그것이 옳다.
let moduleActions: OverlaySlotActions | null = null;

/** 훅을 쓸 수 없는 모듈 함수가 자리를 잡을 때 쓴다. Provider가 없으면 null. */
export function getOverlaySlotActions(): OverlaySlotActions | null {
  return moduleActions;
}

// ── 떠 있는 네이티브 표면의 점유(Provider 교체를 견딘다) ──────────────────────
// ⚠️ **`getOverlaySlotActions()`의 반환값을 붙들고 있으면 안 된다.** 세션 만료 안내가 떠 있는
//    동안 게스트→소셜 승격으로 `userId`가 바뀌면 `App.tsx`의 `<UserProvider key={userId}>`가
//    서브트리를 통째로 리마운트해 **Provider가 교체**된다. 그때
//      · 캡처해 둔 actions는 **폐기된 registry**를 가리키고,
//      · 새 호스트는 점유가 없다고 판단해 그 Alert **뒤에서** 결과를 마운트하며,
//      · 닫힘 콜백은 죽은 registry만 해제한다.
//    (이 경로가 실재한다는 것은 `promptSessionExpired` 자신이 전제한다 — 확인 버튼의 세대
//     대조가 바로 "안내 표시 중 세션 교체" 구간을 다룬다.)
// 그래서 **모듈이 점유 목록을 들고**, Provider가 새로 서면 그 목록을 다시 등록한다.
// 반납도 캡처가 아니라 **그 시점의 현재 Provider**에 한다.
const nativeHolds = new Set<{ id: string; priority: number }>();

/**
 * 훅 없이 자리를 점유한다 — 반환된 함수를 부르면 반납한다.
 * Provider가 교체되면 새 Provider에 자동으로 다시 등록된다(위 주석).
 */
// ── "보유자가 사용자 조작으로 반드시 닫히는가" ───────────────────────────────
// 네이티브 Alert를 **즉시 띄울지 기다릴지**를 가르는 축이다. 앞서 세운 규칙("이미 자기가 자리를
// 쥐고 있으면 즉시, 아니면 기다린다")은 두 경우를 뭉갠다:
//   · 보유자가 **호출부 자신의 시트**  → 그 시트는 **이 실패 때문에** 안 닫힐 수 있다.
//     기다리면 사용자가 죽은 세션에 갇힌 채 이유를 모른다 → **즉시 띄운다.**
//   · 보유자가 **노출 중인 결과 모달** → 사용자가 닫기를 누르면 **반드시** 닫힌다 →
//     **기다린다.** 여기서 덮으면 확인 버튼이 로그아웃을 불러 모달째 사라지고, ack는 노출
//     시점에 이미 나갔으므로(D8) **그 정산 내용을 어느 경로로도 다시 못 본다.**
// 그래서 조정자가 "지금 사용자 조작으로만 닫히는 오버레이가 노출 중인가"를 들고 있고,
// 모듈 함수는 그것만 보고 판단한다(그룹 모듈을 import하지 않는다 — sessionErrors 헤더의 이유).
// ⚠️ 기다림에 **상한을 두지 않는다.** 그 오버레이는 사용자가 닫아야만 사라지므로 무한 대기가
//    아니고, 상한을 두면 그 시점에 다시 덮는 것이라 고친 것이 없다.
const userDismissableOverlays = new Set<string>();
let dismissWaiters: (() => void)[] = [];

/** 사용자 조작으로만 닫히는 오버레이가 **지금 노출 중**임을 알린다(노출이 끝나면 false). */
export function markOverlayUserDismissable(id: string, exposed: boolean): void {
  if (exposed) {
    userDismissableOverlays.add(id);
    return;
  }
  if (!userDismissableOverlays.delete(id)) return;
  if (userDismissableOverlays.size > 0) return;
  const waiters = dismissWaiters;
  dismissWaiters = [];
  waiters.forEach((resolve) => resolve());
}

/** 그런 오버레이가 하나도 노출돼 있지 않을 때까지 기다린다(없으면 즉시). */
export function whenNoUserDismissableOverlay(): Promise<void> {
  if (userDismissableOverlays.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    dismissWaiters.push(resolve);
  });
}

export function holdOverlaySlotForNativeSurface(id: string, priority: number): () => void {
  const hold = { id, priority };
  nativeHolds.add(hold);
  moduleActions?.request(id, priority);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    nativeHolds.delete(hold);
    // 같은 id를 쥔 다른 표면이 남아 있으면 등록을 유지한다.
    if (Array.from(nativeHolds).some((other) => other.id === id)) return;
    moduleActions?.release(id);
  };
}

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
  // ── 명령형 승인은 **id당 한 번에 하나** ────────────────────────────────────────
  // registry는 id 하나에 항목 하나다. 그래서 같은 id로 두 승인이 동시에 살아 있으면,
  // **먼저 끝난 쪽의 반납이 그 하나뿐인 항목을 지운다** — 두 번째 시트가 아직 떠 있는데
  // 자리는 비어, 결과 모달이 그 아래에서 노출·ack된다. 초대 버튼을 빠르게 두 번 누르면
  // 실제로 그렇게 된다(두 번째 `acquire`가 "이미 내가 보유자"라 즉시 승인되던 경로).
  // 그래서 승인이 살아 있는 동안에는 같은 id의 다음 요청을 **대기열에 세운다.**
  // ⚠️ 대기 중이던 두 번째는 반납 시점에 `false`로 깨어나 **조용히 접힌다**(승계하지 않는다).
  //    연타의 두 번째 탭을 몇 초 뒤에 되살려 공유 시트를 다시 여는 것은 사용자가 기대한 바가
  //    아니다 — 그 사이 사용자는 이미 공유를 마쳤다.
  const grantedRef = useRef(new Set<string>());
  const settleOneAcquireWaiter = useCallback((id: string) => {
    if (grantedRef.current.has(id)) return; // 살아 있는 승인이 있다 — 다음 요청은 계속 기다린다.
    const waiters = acquireWaitersRef.current;
    const index = waiters.findIndex((waiter) => waiter.id === id);
    if (index === -1) return;
    const [waiter] = waiters.splice(index, 1);
    grantedRef.current.add(id);
    waiter.resolve(true);
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
    if (nextHolder !== null) settleOneAcquireWaiter(nextHolder);
  }, [readLiveMaxPriority, settleOneAcquireWaiter]);

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
      grantedRef.current.delete(id);
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
      // ⚠️ 보유자가 나여도 **살아 있는 승인이 있으면 즉시 승인하지 않는다**(위 grantedRef 주석).
      //    연타의 두 번째 탭이 정확히 이 경로로 들어와 두 시트를 동시에 열던 자리다.
      if (stateRef.current.holderId === id && !grantedRef.current.has(id)) {
        grantedRef.current.add(id);
        return Promise.resolve(true);
      }
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

  // React 밖의 호출자(위 getOverlaySlotActions)에게 이 Provider의 통로를 열어 둔다.
  // ⚠️ 그리고 **아직 떠 있는 네이티브 표면의 점유를 물려받는다.** Provider가 교체돼도 그 표면은
  //    화면에 그대로 남으므로, 새 registry에 다시 등록하지 않으면 그 뒤에서 결과가 마운트된다.
  useEffect(() => {
    moduleActions = actions;
    nativeHolds.forEach((hold) => actions.request(hold.id, hold.priority));
    return () => {
      if (moduleActions === actions) moduleActions = null;
    };
  }, [actions]);

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
