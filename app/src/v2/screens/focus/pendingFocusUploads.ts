// 집중 세션 업로드 재시도 대기열(GROMO-614) — POST /focus-session 실패 시 요청 바디를
// AsyncStorage에 쌓아두고 나중에 다시 보낸다. 로컬 적립(집중시간·과목·코인)은 정산 시점에
// 이미 반영되므로, 여기서는 서버 기록만 따라잡으면 로컬·서버가 일치한다.
// flush는 PendingFocusUploader가 앱 시작 1회 + 포그라운드 복귀마다 호출한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveFocusSession } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';
import type { FocusSessionRequest } from '@/types/dto/focus';

// 무한 적체 방지 상한 — 초과분은 오래된 항목부터 버린다.
const MAX_PENDING = 50;

// 대기열 조작(읽기-수정-쓰기)을 직렬화 — enqueue와 flush가 겹쳐도 항목이 유실/중복되지 않게.
let chain: Promise<void> = Promise.resolve();
function serialize(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task);
  return chain;
}

async function readQueue(): Promise<FocusSessionRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusPendingUploads);
    return raw ? (JSON.parse(raw) as FocusSessionRequest[]) : [];
  } catch {
    return []; // 깨진 값은 버린다
  }
}

async function writeQueue(queue: FocusSessionRequest[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(STORAGE_KEYS.focusPendingUploads);
  else await AsyncStorage.setItem(STORAGE_KEYS.focusPendingUploads, JSON.stringify(queue));
}

// 업로드 실패한 세션을 대기열에 추가.
export function enqueuePendingFocusUpload(body: FocusSessionRequest): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    queue.push(body);
    await writeQueue(queue.slice(-MAX_PENDING));
  });
}

// 대기열 재시도 — 성공한 항목만 제거하고 실패분은 남겨 다음 flush에서 다시 시도한다.
export function flushPendingFocusUploads(): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const failed: FocusSessionRequest[] = [];
    for (const body of queue) {
      try {
        await saveFocusSession(body);
      } catch {
        failed.push(body);
      }
    }
    await writeQueue(failed);
  });
}
