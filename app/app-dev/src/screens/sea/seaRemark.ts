import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import { updateSeaRemark } from '@/services/api/focusSessions';

/**
 * 바다 한마디 저장(GROMO-2310) — 망원경 출항 직후와 표류 중 [한마디 쓰기]가 같이 쓴다.
 * 저장했으면 true. 게스트(403 `SOCIAL_LOGIN_REQUIRED` → 회원 전환 시트)와 5분 잠금(409 `SEA_REMARK_LOCKED` → 토스트)은
 * 여기서 처리하고 false. 그 밖 실패는 던진다 — 호출부가 재시도 안내(바다 화면) 또는 출항 유지(망원경)를 고른다.
 */
export async function saveSeaRemark(
  e: { notify: (text: string) => void; conversion?: { offer: (error: unknown) => boolean } },
  remark: string,
): Promise<boolean> {
  try {
    await updateSeaRemark(remark);
    return true;
  } catch (thrown) {
    if (e.conversion?.offer(thrown)) return false;
    if (thrown instanceof ApiError && thrown.code === 'SEA_REMARK_LOCKED') {
      e.notify(t('openSea.remarkLocked'));
      return false;
    }
    throw thrown;
  }
}
