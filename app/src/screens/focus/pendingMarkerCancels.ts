// 라이브 마커 취소 재시도 대기열(GROMO-1214 코드리뷰) — pendingFocusUploads와 같은 결.
//
// 마커를 못 닫으면 친구 화면에 서버 고아 스윕(12h)까지 '집중 중'으로 남는다. 종전엔 실패한 id를
// 화면 ref(pendingCancelIdsRef)에만 담았는데, finish()는 업로드를 시작하자마자 화면을 떠나므로
// id가 담긴 직후 컴포넌트가 언마운트되면 재시도가 다시 돌 기회가 없었다 — 일시적 실패 하나로
// 12시간이 날아갔다. 이제 AsyncStorage에 남겨 앱 시작·포그라운드 복귀마다 flush한다
// (PendingFocusUploader가 세션 업로드 대기열과 같은 시점에 부른다).
//
// 계정 스코프(GROMO-1214 코드리뷰 2차) — 디바이스 전역 키라서 항목마다 마커를 만든 계정(userId)을
// 같이 저장하고, **그 계정으로 로그인해 있을 때만** 재시도한다. 종전엔 계정 무관하게 보내고 403을
// 영구 실패로 보고 버렸는데, 큐는 로그아웃·계정전환에서 비워지지 않아 A로 쌓인 취소가 B 로그인 중
// 403을 받고 사라졌다 — A의 마커가 A가 다시 로그인해도 12h 스윕까지 '집중 중'으로 남았다.
// pendingFocusUploads와 달리 다른 계정 항목을 **버리지 않고 보존**한다: 업로드는 잘못 올라가면
// 통계가 오염되지만, 취소는 그 계정으로 돌아오기만 하면 여전히 유효한 뒷정리다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { cancelFocusSession } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';

// 큐 항목 — 마커 id와 그 마커를 만든 계정(로그인 UUID 또는 게스트 null).
interface PendingMarkerCancel {
  userId: string | null;
  sessionId: string;
}

// 무한 적체 방지 상한 — 초과분은 오래된 항목부터 버린다(pendingFocusUploads와 동일 규칙).
const MAX_PENDING = 50;

// 대기열 조작(읽기-수정-쓰기)을 직렬화 — enqueue와 flush가 겹쳐도 id가 유실/중복되지 않게.
// 네트워크 요청은 락 밖에서 한다(pendingFocusUploads와 같은 이유).
let chain: Promise<void> = Promise.resolve();
function serialize(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task);
  return chain;
}

async function readQueue(): Promise<PendingMarkerCancel[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels);
    const parsed = raw ? (JSON.parse(raw) as PendingMarkerCancel[]) : [];
    // 형태가 다른 값(깨진 항목)은 버린다 — sessionId가 없으면 취소할 대상을 알 수 없다.
    return Array.isArray(parsed)
      ? parsed.filter((item) => item != null && typeof item.sessionId === 'string')
      : [];
  } catch {
    return []; // 깨진 값은 버린다
  }
}

async function writeQueue(queue: PendingMarkerCancel[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(STORAGE_KEYS.focusPendingCancels);
  else await AsyncStorage.setItem(STORAGE_KEYS.focusPendingCancels, JSON.stringify(queue));
}

// 취소 1건 시도 — 재시도할 필요가 없으면(= 큐에서 빼도 되면) true.
// 성공(204)은 물론, 재시도로 풀리지 않는 4xx도 버린다: 409(이미 종료/취소 — 목적 달성), 404(마커 소실).
// **403은 예외** — 큐 항목이 소유 계정으로만 재시도되므로 여기서의 403은 일시적 배선 문제(토큰 갱신
// 지연 등)일 수 있다. 종결로 보면 마커가 12h 스윕까지 열린 채 남으므로 큐에 남겨 다음 기회를 기다린다.
// 네트워크 실패·5xx도 마찬가지로 남긴다.
async function tryCancel(sessionId: string): Promise<boolean> {
  try {
    await cancelFocusSession({ sessionId });
    return true;
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    return status != null && status >= 400 && status < 500 && status !== 403;
  }
}

// 마커 1건을 취소로 닫는다. 실패하면 대기열에 남겨 다음 실행·포그라운드 복귀에 재시도한다.
// PATCH 종료가 실패해 마커가 열린 채 남았을 때 uploadFocusBlock이 부르는 뒤처리 지점이기도 하다.
// userId는 이 마커를 만든 계정 — 재시도를 그 계정으로 제한하는 데 쓴다.
export async function cancelMarker(sessionId: string, userId: string | null): Promise<void> {
  if (!(await tryCancel(sessionId))) await enqueuePendingMarkerCancel(sessionId, userId);
}

// 취소 실패한 마커를 대기열에 추가(같은 id는 한 번만).
export function enqueuePendingMarkerCancel(
  sessionId: string,
  userId: string | null,
): Promise<void> {
  return serialize(async () => {
    const queue = await readQueue();
    if (queue.some((item) => item.sessionId === sessionId)) return;
    queue.push({ userId: userId ?? null, sessionId });
    await writeQueue(queue.slice(-MAX_PENDING));
  });
}

// 동시 flush 중복 실행 방지 — 진행 중이면 skip해도 된다(이미 도는 flush가 같은 큐를 처리 중이고,
// 그 사이 enqueue된 항목은 다음 flush에서 처리된다). pendingFocusUploads와 동일.
let flushing = false;

// 대기열 재시도 — 3단계 구조(락 안 스냅샷 → 락 밖 전송 → 락 안 재조정)도 pendingFocusUploads와 같다.
// currentUserId는 현재 로그인 계정. 소유 계정이 다른 항목은 보내지 않고 큐에 그대로 둔다.
export async function flushPendingMarkerCancels(currentUserId: string | null): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let snapshot: PendingMarkerCancel[] = [];
    await serialize(async () => {
      snapshot = await readQueue();
    });
    const mine = snapshot.filter((item) => item.userId === currentUserId);
    if (mine.length === 0) return;

    const settled: string[] = [];
    for (const item of mine) {
      if (await tryCancel(item.sessionId)) settled.push(item.sessionId);
    }
    if (settled.length === 0) return;

    await serialize(async () => {
      const queue = await readQueue();
      await writeQueue(queue.filter((item) => !settled.includes(item.sessionId)));
    });
  } finally {
    flushing = false;
  }
}
