import { currentFocusSession } from './api/focusSessions';
import { screenTime } from './screenTime';
import { getSession, sessionGeneration } from './api/session';
import type { Color, Session } from './model';

let queue: Promise<unknown> = Promise.resolve();
let revision = 0;

/** 종료·계정 교체가 대기 중인 적용보다 우선한다. 이미 실행한 적용 뒤에는 해제가 이어진다. */
export function syncFocusShield(
  session: Session | null,
  color: Color = 'black',
  verifyServer = false,
): Promise<boolean> {
  const request = ++revision;
  const generation = sessionGeneration();
  const owner = getSession()?.userId;
  const current = () =>
    request === revision && generation === sessionGeneration() && owner === getSession()?.userId;
  const result = queue.then(async () => {
    if (!current()) return true;
    let subject = session?.status === 'active' ? session.subject : null;
    if (verifyServer && owner) {
      try {
        const confirmed = await currentFocusSession();
        if (!current()) return true;
        subject = confirmed?.status === 'active' ? confirmed.subject : null;
      } catch (error) {
        // 정본을 확인할 수 없으면 오래된 활성 상태로 다른 앱을 계속 잠그지 않는다.
        if (!current()) return true;
        await screenTime.stopFocusShield();
        throw error;
      }
    }
    if (subject !== null) {
      if (!owner) return false;
      // 계정 측정 초기화가 새 세션의 실드를 나중에 지우지 않도록 소유자 확정을 먼저 마친다.
      await screenTime.bindMeasurementOwner(owner);
      if (!current()) return true;
      return screenTime.startFocusShield(subject, color);
    }
    await screenTime.stopFocusShield();
    return true;
  });
  queue = result.catch(() => undefined);
  return result;
}

/** 차단을 못 걸었을 때 알릴지. 스크린타임 권한을 허용하지 않아 건너뛴 것은 실패가 아니다(GROMO-2515). */
export const shouldReportShieldFailure = async () =>
  (await screenTime.getAuthorizationStatus().catch(() => 'unavailable')) === 'approved';
