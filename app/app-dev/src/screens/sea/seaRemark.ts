import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import { updateSeaRemark } from '@/services/api/focusSessions';
import { getSession } from '@/services/api/session';
import { SeaNotice } from './seaModel';

// 마지막으로 저장한 한마디의 잠금 끝(기기 시각) — 망원경 출항 직후 저장한 잠금도 바다 화면이 이어 쓰도록 모듈에 둔다.
// 사용자별이라 다른 계정으로 바뀌면 쓰지 않는다. 성공 응답과, 남은 시간(Retry-After)이 실린 409 를 기록한다(옛 서버 409 는 코드뿐).
let lock: { userId: string | undefined; until: number } | null = null;

/** 지금 사용자의 한마디 잠금이 남은 초(없으면 0). */
export const seaRemarkCooldownSeconds = (now: number) =>
  lock && lock.userId === getSession()?.userId
    ? Math.max(0, Math.ceil((lock.until - now) / 1000))
    : 0;

// 내용 때문에 거절된 400(금칙어 · 한 줄/보이는 글자 규칙 · 길이) — 다시 눌러도 같으니 연결 실패 문구 대신 내용 문구를 보인다
const CONTENT_ERRORS = new Set(['BANNED_WORD', 'INVALID_REQUEST', 'INVALID_PARAMETER']);

/**
 * 바다 한마디 저장(GROMO-2310) — 망원경 출항 직후와 표류 중 [한마디 쓰기]가 같이 쓴다.
 * 저장했으면 true. 게스트(403 `SOCIAL_LOGIN_REQUIRED` → 회원 전환 시트)와 5분 잠금(409 `SEA_REMARK_LOCKED` → 토스트)은
 * 여기서 처리하고 false. 내용 거절(400)은 내용 문구의 `SeaNotice` 로, 그 밖 실패는 그대로 던진다 — 호출부가 재시도 안내(바다 화면)
 * 또는 출항 유지(망원경)를 고른다.
 */
export async function saveSeaRemark(
  e: { notify: (text: string) => void; conversion?: { offer: (error: unknown) => boolean } },
  remark: string,
): Promise<boolean> {
  try {
    const saved = await updateSeaRemark(remark);
    // 잠금 길이는 서버 시각 둘의 차(lockedUntil − changedAt)로 받아 기기 시각에 얹는다 — 기기·서버 시계 차이를 타지 않는다
    const span = Date.parse(saved?.lockedUntil) - Date.parse(saved?.changedAt);
    if (span > 0) lock = { userId: getSession()?.userId, until: Date.now() + span };
    return true;
  } catch (thrown) {
    if (e.conversion?.offer(thrown)) return false;
    if (thrown instanceof ApiError && thrown.code === 'SEA_REMARK_LOCKED') {
      const wait = thrown.retryAfterMs ?? 0;
      if (wait > 0) {
        // 응답이 유실된 저장 뒤 재시도면 기기는 잠금을 모른다 — 서버가 준 남은 시간으로 잠금을 맞춘다(GROMO-2760)
        lock = { userId: getSession()?.userId, until: Date.now() + wait };
        e.notify(t('openSea.messageWait', { minutes: Math.ceil(wait / 60_000) }));
      } else e.notify(t('openSea.remarkLocked'));
      return false;
    }
    if (thrown instanceof ApiError && CONTENT_ERRORS.has(thrown.code))
      throw new SeaNotice(t('errors.BANNED_WORD'));
    throw thrown;
  }
}
