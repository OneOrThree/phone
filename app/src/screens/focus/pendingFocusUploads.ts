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
// 락은 스토리지 읽기/쓰기 구간에만 건다. 네트워크 요청(리뷰 반영)은 락 밖에서 수행 —
// 요청당 타임아웃 × 최대 50건이면 flush가 수 분간 락을 점유해, 그 사이 실패한 세션의
// enqueue가 스토리지에 쓰이지 못하고 메모리에만 남아 앱 종료 시 유실될 수 있다.
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

// 동시 flush 중복 실행 방지 — 예전에는 serialize가 flush 전체를 감싸 자연히 보장됐지만,
// 이제 네트워크 구간이 락 밖이라 별도 플래그가 필요하다. 진행 중이면 skip해도 되는 이유:
// 이미 도는 flush가 같은 대기열을 처리 중이고, 그 사이 enqueue된 항목은 다음 flush
// (포그라운드 복귀마다 호출)에서 처리된다.
let flushing = false;

// 대기열 재시도 — 성공한 항목만 제거하고 실패분은 남겨 다음 flush에서 다시 시도한다.
// currentUserId는 현재 로그인 계정(useUser().userId). 저장된 userId와 다른 항목은
// 다른 계정 소유로 업로드되면 안 되므로 재시도하지 않고 버린다. userId 필드가 없는
// 구버전 항목도 소유 계정을 알 수 없으므로 같이 버린다(undefined !== null/UUID).
//
// 3단계 구조: (1) 락 안에서 스냅샷 읽기 → (2) 락 밖에서 업로드 시도 →
// (3) 락 안에서 큐를 다시 읽어(그 사이 enqueue된 새 항목 보존) 처리된 항목만 빼고 재저장.
//
// 반환값: 이 flush 로 **실제 커밋된 저장이 있었는지**. 있으면 서버 잔액이 바뀌었으므로 호출자
// (PendingFocusUploader)가 잔액을 다시 받아온다 — 대기열이 늦게 커밋한 지급이 다음 잔액 조회
// 전까지 화면에 안 나타나던 문제(GROMO-1049).
export async function flushPendingFocusUploads(currentUserId: string | null): Promise<boolean> {
  if (flushing) return false;
  flushing = true;
  let committed = false;
  try {
    // 1단계 — 스냅샷 읽기 (락 안)
    let snapshot: PendingFocusUpload[] = [];
    await serialize(async () => {
      snapshot = await readQueue();
    });
    if (snapshot.length === 0) return false;

    // 2단계 — 업로드 시도 (락 밖). 성공(제거)·폐기 대상을 직렬화 문자열로 수집하고,
    // 실패분은 수집하지 않아 큐에 남긴다.
    const settled: string[] = [];
    for (const item of snapshot) {
      if (!item || typeof item !== 'object' || !item.body) {
        settled.push(JSON.stringify(item)); // 구버전/깨진 항목 폐기
        continue;
      }
      if (item.userId !== currentUserId) {
        settled.push(JSON.stringify(item)); // 다른 계정 항목 폐기
        continue;
      }
      try {
        await saveFocusSession(item.body);
        // 이 저장으로 서버 잔액이 바뀌었다 — 호출자가 잔액을 다시 받아오게 알린다(GROMO-1049).
        committed = true;
        settled.push(JSON.stringify(item)); // 성공 — 제거
      } catch {
        // 실패 — 유지, 다음 flush에서 재시도
      }
    }
    if (settled.length === 0) return committed;

    // 3단계 — 재조정 (락 안). 내용이 같은 중복 항목은 처리한 개수만큼만 제거한다.
    await serialize(async () => {
      const queue = await readQueue();
      const remaining = [...settled];
      const next = queue.filter((item) => {
        const idx = remaining.indexOf(JSON.stringify(item));
        if (idx === -1) return true;
        remaining.splice(idx, 1);
        return false;
      });
      await writeQueue(next);
    });
    return committed;
  } finally {
    flushing = false;
  }
}
