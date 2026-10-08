import { screenTime } from './screenTime';
import { getSession, sessionGeneration } from './api/session';
import type { Session } from './model';

let queue: Promise<unknown> = Promise.resolve();
let revision = 0;

/** 종료·계정 교체가 대기 중인 적용보다 우선한다. 이미 실행한 적용 뒤에는 해제가 이어진다. */
export function syncFocusShield(session: Session | null): Promise<boolean> {
  const request = ++revision;
  const generation = sessionGeneration();
  const subject = session?.status === 'active' ? session.subject : null;
  const result = queue.then(async () => {
    if (request !== revision || generation !== sessionGeneration()) return true;
    if (subject !== null) {
      const owner = getSession()?.userId;
      if (!owner) return false;
      // 계정 측정 초기화가 새 세션의 실드를 나중에 지우지 않도록 소유자 확정을 먼저 마친다.
      await screenTime.bindMeasurementOwner(owner);
      if (request !== revision || generation !== sessionGeneration()) return true;
      return screenTime.startFocusShield(subject);
    }
    await screenTime.stopFocusShield();
    return true;
  });
  queue = result.catch(() => undefined);
  return result;
}
