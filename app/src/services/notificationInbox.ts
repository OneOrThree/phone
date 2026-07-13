// 알림 보관함 (GROMO-661) — 수신한 서버 푸시를 로컬(AsyncStorage)에 저장해 알림 화면에 보여준다.
// 지금은 로컬 저장이 유일한 데이터 원천이고, 추후 BE 알림 이력 API가 생기면 이 모듈만 교체한다.
// ⚠️ iOS 한계: 앱이 꺼진/백그라운드 상태로 도착만 하고 탭하지 않은 알림은 앱 코드가 실행되지
// 않아 저장되지 않는다(포그라운드 수신·알림 탭 진입만 기록). 완전한 이력은 BE 전환 시 해결.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

// 보관함에 저장할 알림 타입 — "저장할/안 할 알림" 분류 정책이 정해지면 여기만 고친다.
// 'all'이면 타입 무관 전부 저장(현재 동작). 제한하려면 ['rank_change', ...] 형태로 교체.
const STORED_TYPES: 'all' | readonly string[] = 'all';

export interface InboxNotification {
  id: string; // FCM messageId 우선(중복 저장 방지 키), 없으면 수신 시각 기반
  type: string | null; // 서버 payload의 data.type/category 원문 (예: 'rank_change')
  title: string;
  body: string;
  link: string | null; // gromo:// 딥링크 — 목록에서 탭하면 이동
  receivedAt: number; // 수신 시각(epoch ms)
  read: boolean;
}

// 보관 상한 — 초과분은 오래된 것부터 버린다.
const MAX_ITEMS = 50;

// 보관함 변경 구독 — 홈 종 뱃지(빨간 점)가 저장/읽음 처리에 맞춰 갱신되도록 알린다.
type InboxListener = () => void;
const listeners = new Set<InboxListener>();

export function subscribeInbox(listener: InboxListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

async function loadAll(): Promise<InboxNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.notificationInbox);
    return raw ? (JSON.parse(raw) as InboxNotification[]) : [];
  } catch {
    return []; // 파싱/읽기 실패 → 빈 보관함으로 취급
  }
}

async function saveAll(items: InboxNotification[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.notificationInbox, JSON.stringify(items));
}

// 저장 대상 타입인지 판정 — STORED_TYPES 정책의 단일 적용 지점.
function shouldStore(type: string | null): boolean {
  return STORED_TYPES === 'all' || (type !== null && STORED_TYPES.includes(type));
}

// 보관함 수정(읽기→고치기→쓰기) 직렬화 큐 — 푸시 2건이 거의 동시에 저장되면 둘 다 같은
// 스냅샷을 읽고 나중 쓰기가 먼저 쓴 알림을 덮어써 유실될 수 있어(PR 224 리뷰),
// 수정 작업은 한 번에 하나씩 실행한다.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(task);
  writeQueue = next.catch(() => {}); // 작업이 실패해도 큐는 계속 흐르게
  return next;
}

// 수신/탭한 푸시 1건을 보관함 맨 앞에 저장. 같은 id가 이미 있으면 무시(중복 진입 대비).
export async function addToInbox(input: {
  id?: string;
  type: string | null;
  title: string;
  body: string;
  link: string | null;
  receivedAt?: number; // FCM 발송 시각(sentTime) — 없으면 저장 시각으로 대체
}): Promise<void> {
  if (!shouldStore(input.type)) return;
  if (!input.title && !input.body) return; // 표시할 내용이 없는 payload는 버림
  await enqueueWrite(async () => {
    try {
      const items = await loadAll();
      const id = input.id ?? `local-${Date.now()}`;
      if (items.some((n) => n.id === id)) return;
      // receivedAt 내림차순 정렬 유지 — 몇 시간 전 발송된 알림(sentTime)을 뒤늦게 탭해 저장하면
      // 단순 맨 앞 삽입으로는 더 새 알림 위로 올라가 최신순이 깨진다(PR 226 리뷰).
      const next: InboxNotification[] = [
        {
          id,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          receivedAt: input.receivedAt ?? Date.now(),
          read: false,
        },
        ...items,
      ]
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, MAX_ITEMS);
      await saveAll(next);
      emitChange();
    } catch {
      // 저장 실패는 무시 — 알림 수신/딥링크 흐름을 막지 않는다.
    }
  });
}

// 보관함 비우기 — 로그아웃/계정 전환 정리에서 호출. 같은 쓰기 큐를 타므로 직전에 시작된
// 푸시 저장(옛 스냅샷)이 끝난 뒤 지워져, 정리 후 이전 계정 알림이 되살아나지 않는다(PR 224 리뷰).
export async function clearInbox(): Promise<void> {
  await enqueueWrite(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.notificationInbox);
      emitChange();
    } catch {
      // 삭제 실패는 무시 — 다음 로그아웃/계정 전환 정리에서 재시도된다.
    }
  });
}

// 보관함 전체(최신순).
export async function getInbox(): Promise<InboxNotification[]> {
  return loadAll();
}

// 지정한 id만 읽음 처리 — 알림 화면이 진입 시점 스냅샷의 id로 호출한다. 전체 읽음으로 하면
// 스냅샷 직후 도착해 화면에 안 보인 알림까지 읽음 처리돼 조용히 묻힐 수 있다(PR 224 리뷰).
export async function markRead(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await enqueueWrite(async () => {
    try {
      const idSet = new Set(ids);
      const items = await loadAll();
      if (!items.some((n) => !n.read && idSet.has(n.id))) return;
      await saveAll(items.map((n) => (!n.read && idSet.has(n.id) ? { ...n, read: true } : n)));
      emitChange();
    } catch {
      // 실패해도 다음 진입 때 다시 시도된다.
    }
  });
}

// 안 읽은 알림 존재 여부 — 홈 종 뱃지용.
export async function hasUnread(): Promise<boolean> {
  return (await loadAll()).some((n) => !n.read);
}
