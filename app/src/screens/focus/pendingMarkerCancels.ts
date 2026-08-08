// 라이브 마커 취소 재시도 대기열(GROMO-1214 코드리뷰) — pendingFocusUploads와 같은 결.
//
// 마커를 못 닫으면 친구 화면에 서버 고아 스윕(12h)까지 '집중 중'으로 남는다. 종전엔 실패한 id를
// 화면 ref(pendingCancelIdsRef)에만 담았는데, finish()는 업로드를 시작하자마자 화면을 떠나므로
// id가 담긴 직후 컴포넌트가 언마운트되면 재시도가 다시 돌 기회가 없었다 — 일시적 실패 하나로
// 12시간이 날아갔다. 이제 AsyncStorage에 남겨 앱 시작·포그라운드 복귀마다 flush한다
// (PendingFocusUploader가 세션 업로드 대기열과 같은 시점에 부른다).
//
// 계정 스코프는 두지 않는다 — 취소는 적립이 아니라 '내 마커 닫기'라 오귀속될 값이 없고, 계정이
// 바뀐 뒤 남의 마커를 취소하려 하면 서버가 403으로 막는다(아래 tryCancel이 영구 실패로 보고 버린다).
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { cancelFocusSession } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';

// 무한 적체 방지 상한 — 초과분은 오래된 항목부터 버린다(pendingFocusUploads와 동일 규칙).
const MAX_PENDING = 50;

// 대기열 조작(읽기-수정-쓰기)을 직렬화 — enqueue와 flush가 겹쳐도 id가 유실/중복되지 않게.
// 네트워크 요청은 락 밖에서 한다(pendingFocusUploads와 같은 이유).
let chain: Promise<void> = Promise.resolve();
function serialize(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task);
  return chain;
}

async function readQueue(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return []; // 깨진 값은 버린다
  }
}

async function writeQueue(ids: string[]): Promise<void> {
  if (ids.length === 0) await AsyncStorage.removeItem(STORAGE_KEYS.focusPendingCancels);
  else await AsyncStorage.setItem(STORAGE_KEYS.focusPendingCancels, JSON.stringify(ids));
}

// 취소 1건 시도 — 재시도할 필요가 없으면(= 큐에서 빼도 되면) true.
// 성공(204)은 물론, 4xx도 재시도로 풀리지 않으므로 버린다: 409(이미 종료/취소 — 목적 달성),
// 404(마커 소실), 403(계정 전환). 네트워크 실패·5xx만 큐에 남겨 다음 기회에 다시 보낸다.
async function tryCancel(sessionId: string): Promise<boolean> {
  try {
    await cancelFocusSession({ sessionId });
    return true;
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    return status != null && status >= 400 && status < 500;
  }
}

// 마커 1건을 취소로 닫는다. 실패하면 대기열에 남겨 다음 실행·포그라운드 복귀에 재시도한다.
// PATCH 종료가 실패해 마커가 열린 채 남았을 때 uploadFocusBlock이 부르는 뒤처리 지점이기도 하다.
export async function cancelMarker(sessionId: string): Promise<void> {
  if (!(await tryCancel(sessionId))) await enqueuePendingMarkerCancel(sessionId);
}

// 취소 실패한 마커 id를 대기열에 추가(같은 id는 한 번만).
export function enqueuePendingMarkerCancel(sessionId: string): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    if (queue.includes(sessionId)) return;
    queue.push(sessionId);
    await writeQueue(queue.slice(-MAX_PENDING));
  });
}

// 동시 flush 중복 실행 방지 — 진행 중이면 skip해도 된다(이미 도는 flush가 같은 큐를 처리 중이고,
// 그 사이 enqueue된 항목은 다음 flush에서 처리된다). pendingFocusUploads와 동일.
let flushing = false;

// 대기열 재시도 — 3단계 구조(락 안 스냅샷 → 락 밖 전송 → 락 안 재조정)도 pendingFocusUploads와 같다.
export async function flushPendingMarkerCancels(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let snapshot: string[] = [];
    await serialize(async () => {
      snapshot = await readQueue();
    });
    if (snapshot.length === 0) return;

    const settled: string[] = [];
    for (const sessionId of snapshot) {
      if (await tryCancel(sessionId)) settled.push(sessionId);
    }
    if (settled.length === 0) return;

    await serialize(async () => {
      const queue = await readQueue();
      await writeQueue(queue.filter((id) => !settled.includes(id)));
    });
  } finally {
    flushing = false;
  }
}
