import { currentFocusSession } from './api/focusSessions';
import { Platform } from 'react-native';
import { screenTime } from './screenTime';
import { screenTimeNative } from './ScreenTimeModule';
import { getSession, sessionGeneration } from './api/session';
import type { Color, Session } from './model';

let queue: Promise<unknown> = Promise.resolve();
let revision = 0;

/** 네이티브 쓰기만 직렬화한다. 서버 조회가 지연돼도 휴식·종료 해제는 기다리지 않는다. */
export function syncFocusShield(
  session: Session | null,
  color: Color = 'black',
  verifyServer = false,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const request = ++revision;
  const generation = sessionGeneration();
  const owner = getSession()?.userId;
  const current = () =>
    isCurrent() &&
    request === revision &&
    generation === sessionGeneration() &&
    owner === getSession()?.userId;
  const write = (apply: () => Promise<boolean>) => {
    const result = queue.then(() => (current() ? apply() : true));
    queue = result.catch(() => undefined);
    return result;
  };
  const clear = () =>
    write(async () => {
      await screenTime.stopFocusShield();
      return true;
    });
  return (async () => {
    if (!current()) return true;
    let subject = session?.status === 'active' ? session.subject : null;
    // 서버 명령으로 이미 휴식·종료한 상태는 추가 조회보다 먼저 해제한다.
    const cleared = subject === null;
    if (cleared) await clear();
    if (!current()) return true;
    if (!owner) return cleared;
    try {
      const authorization = await screenTime.getAuthorizationStatus();
      if (!current()) return true;
      if (authorization !== 'approved') return cleared ? true : clear();
      if (verifyServer) {
        const confirmed = await currentFocusSession();
        if (!current()) return true;
        subject = confirmed?.status === 'active' ? confirmed.subject : null;
      }
    } catch (error) {
      // 정본을 확인할 수 없으면 기존처럼 해제하고 호출부가 재시도한다.
      if (!current()) return true;
      if (!cleared) await clear();
      throw error;
    }
    if (subject === null) return cleared ? true : clear();
    const confirmedSubject = subject;
    return write(async () => {
      // 계정 측정 초기화가 새 세션의 실드를 나중에 지우지 않도록 소유자 확정을 먼저 마친다.
      await screenTime.bindMeasurementOwner(owner);
      if (!current()) return true;
      return screenTime.startFocusShield(confirmedSubject, color);
    });
  })();
}

/**
 * 집중 중 다른 앱이 실제로 막히는지(GROMO-2635). {@link syncFocusShield} 의 반환값은 «동기화 성공»이라 권한이 없어도 true 다.
 * iOS 는 스크린타임 권한이 있어야 막고, Android 는 지금 바이너리가 차단을 지원하지 않는다(`supportsFocusShield=false`).
 */
export const focusShieldApplied = async (): Promise<boolean> =>
  Platform.OS === 'ios'
    ? (await screenTime.getAuthorizationStatus().catch(() => 'unavailable')) === 'approved'
    : // ponytail: Android 차단을 켜는 바이너리가 나오면 다른 앱 위 표시 권한까지 봐야 한다
      Platform.OS === 'android' && screenTimeNative?.supportsFocusShield === true;

/** 차단 상태 변경 실패를 알릴지. 스크린타임 권한을 허용하지 않아 건너뛴 것은 실패가 아니다(GROMO-2515). */
export const shouldReportShieldFailure = async () =>
  (await screenTime.getAuthorizationStatus().catch(() => 'unavailable')) === 'approved';
