// 집중 세션 업로드 재시도 대기열(GROMO-614) — POST /focus-session 실패 시 요청 바디를
// AsyncStorage에 쌓아두고 나중에 다시 보낸다. 로컬 적립(집중시간·과목·코인)은 정산 시점에
// 이미 반영되므로, 여기서는 서버 기록만 따라잡으면 로컬·서버가 일치한다.
// flush는 PendingFocusUploader가 앱 시작 1회 + 포그라운드 복귀마다 호출한다.
//
// 계정 스코프(리뷰 반영) — 디바이스 전역 키라서 항목마다 적립한 계정(userId)을 같이 저장하고,
// flush 시 현재 로그인 userId와 다르면 업로드하지 않고 버린다(PendingGoalApplier와 같은 패턴).
// 로그아웃은 handleLogout이 키를 지워 주지만, 게스트가 설정에서 소셜 로그인하면
// (applyStoredSession) 로그아웃 없이 userId만 바뀌므로 항목별 검증이 필요하다 —
// 안 그러면 게스트 시절 실패한 세션이 새 소셜 계정 소유로 업로드된다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveFocusSession } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';
import type { FocusSessionRequest } from '@/types/dto/focus';

interface PendingFocusUpload {
  userId: string | null; // 적립한 계정 — UUID(로그인) 또는 null(게스트)
  body: FocusSessionRequest;
}

// 무한 적체 방지 상한 — 초과분은 오래된 항목부터 버린다.
const MAX_PENDING = 50;

// 대기열 조작(읽기-수정-쓰기)을 직렬화 — enqueue와 flush가 겹쳐도 항목이 유실/중복되지 않게.
let chain: Promise<void> = Promise.resolve();
function serialize(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task);
  return chain;
}

async function readQueue(): Promise<PendingFocusUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusPendingUploads);
    return raw ? (JSON.parse(raw) as PendingFocusUpload[]) : [];
  } catch {
    return []; // 깨진 값은 버린다
  }
}

async function writeQueue(queue: PendingFocusUpload[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(STORAGE_KEYS.focusPendingUploads);
  else await AsyncStorage.setItem(STORAGE_KEYS.focusPendingUploads, JSON.stringify(queue));
}

// 업로드 실패한 세션을 대기열에 추가. userId는 적립한 계정(useUser().userId).
export function enqueuePendingFocusUpload(
  body: FocusSessionRequest,
  userId: string | null,
): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    queue.push({ userId: userId ?? null, body });
    await writeQueue(queue.slice(-MAX_PENDING));
  });
}

// 대기열 재시도 — 성공한 항목만 제거하고 실패분은 남겨 다음 flush에서 다시 시도한다.
// currentUserId는 현재 로그인 계정(useUser().userId). 저장된 userId와 다른 항목은
// 다른 계정 소유로 업로드되면 안 되므로 재시도하지 않고 버린다. userId 필드가 없는
// 구버전 항목도 소유 계정을 알 수 없으므로 같이 버린다(undefined !== null/UUID).
export function flushPendingFocusUploads(currentUserId: string | null): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const failed: PendingFocusUpload[] = [];
    for (const item of queue) {
      if (!item || typeof item !== 'object' || !item.body) continue; // 구버전/깨진 항목 폐기
      if (item.userId !== currentUserId) continue; // 다른 계정 항목 폐기
      try {
        await saveFocusSession(item.body);
      } catch {
        failed.push(item);
      }
    }
    await writeQueue(failed);
  });
}
