import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionCheck } from '@/services/api/auth';
import { uuid } from '@/services/api/client';
import { clearLocalDataOwner } from '@/services/api/session';
import { clearLegacyUserData } from '@/services/legacyUserData';

/**
 * 탈퇴 의도 — 탈퇴 대상 userId 와 `DELETE /me` 멱등 키를 **요청 전에** 기기에 남긴다.
 *
 * 서버가 탈퇴를 커밋했는데 응답을 잃고 앱까지 종료되면, 메모리에만 있던 의도가 사라져 다음 실행이
 * 로컬 정리(1.x 버킷·누끼 파일·소유자 표식)를 이어 가지 못한다. 이 표식이 남아 있으면 부팅이 서버의
 * `USER_NOT_FOUND` 를 탈퇴 완료로 보고 정리를 마친다. 같은 계정의 재시도는 저장된 키를 재사용해
 * 서버가 첫 결과를 재생하게 한다.
 */
const KEY_WITHDRAWAL_INTENT = 'gromo.withdrawalIntent';

export interface WithdrawalIntent {
  userId: string;
  key: string;
}

export async function readWithdrawalIntent(): Promise<WithdrawalIntent | null> {
  const raw = await AsyncStorage.getItem(KEY_WITHDRAWAL_INTENT);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.userId === 'string' && typeof value?.key === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** 탈퇴 요청 직전에 부른다. 기록하지 못하면 던진다 — 호출부는 탈퇴 요청을 보내지 않는다. */
export async function beginWithdrawal(userId: string): Promise<WithdrawalIntent> {
  const existing = await readWithdrawalIntent().catch(() => null);
  if (existing?.userId === userId) return existing;
  const intent = { userId, key: uuid() };
  await AsyncStorage.setItem(KEY_WITHDRAWAL_INTENT, JSON.stringify(intent));
  return intent;
}

/**
 * 탈퇴한 계정의 로컬 정리. 1.x 사용자 데이터와 소유자 표식이 모두 지워져야 끝난다 — 실패하면 던지고
 * 의도는 남는다. 의도 표식 삭제는 best-effort 다: 남아도 세션이 없는 부팅에서는 쓰이지 않는다.
 */
export async function finishWithdrawalCleanup(userId: string | null): Promise<void> {
  if (userId) await clearLegacyUserData(userId);
  await clearLocalDataOwner();
  await AsyncStorage.removeItem(KEY_WITHDRAWAL_INTENT).catch(() => {});
}

/**
 * 부팅에서 남은 탈퇴 의도를 정리한다. 복구된 세션이 의도의 계정일 때만 판단한다.
 *  - 서버가 `USER_NOT_FOUND` 로 거절 → 탈퇴가 커밋됐다. 로컬 정리를 마친다(true).
 *  - 계정이 살아 있음 → 탈퇴가 커밋되지 않았다. 의도를 버린다.
 *  - 그 밖(오프라인·401) → 판단할 수 없어 의도를 남기고 다음 부팅에 다시 본다.
 */
export async function settleWithdrawalIntent(
  restoredUserId: string | null,
  check: SessionCheck | null,
): Promise<boolean> {
  if (!restoredUserId || !check) return false;
  const intent = await readWithdrawalIntent();
  if (!intent || intent.userId !== restoredUserId) return false;
  if (check.status === 'active') {
    await AsyncStorage.removeItem(KEY_WITHDRAWAL_INTENT);
    return false;
  }
  if (check.status !== 'rejected' || check.reason !== 'userNotFound') return false;
  await finishWithdrawalCleanup(restoredUserId);
  return true;
}
