import { Platform } from 'react-native';
import { currentFocusSession } from './api/focusSessions';
import { screenTimeNative } from './ScreenTimeModule';
import { getSession, sessionGeneration } from './api/session';
import { reportScreenTime } from './screenTimeReporting';
import { observationKey, utcDay, windowStart } from './screenTimeWindow';
import type { Session, Color } from './model';
import { buildLiveActivityPayload } from './liveActivity';

let measurementQueue: Promise<unknown> = Promise.resolve();
/** 원장 소유자 변경과 조회·보고를 순서대로 수행한다. 네이티브의 UTC·KST 관측을 각각 보고한다. */
export function syncAndroidMeasurement() {
  const owner = getSession()?.userId;
  const generation = sessionGeneration();
  const current = () =>
    !!owner && getSession()?.userId === owner && sessionGeneration() === generation;
  const run = measurementQueue.then(async () => {
    if (!current() || !screenTimeNative?.getAndroidMeasurement)
      throw new Error('MEASUREMENT_UNAVAILABLE');
    await screenTimeNative.bindMeasurementOwner?.(owner!);
    if (!current()) throw new Error('STALE_ACCOUNT');
    const measurement = await screenTimeNative.getAndroidMeasurement();
    if (!current() || measurement.owner !== owner) throw new Error('STALE_ACCOUNT');
    const now = Date.now();
    // 구 바이너리·잘못된 응답을 그대로 판정 서버에 보내지 않는다.
    const observations = measurement.observations;
    const measuredAt = Date.parse(observations[0]?.measuredAt ?? '');
    const expected = new Set(
      (['UTC', 'Asia/Seoul'] as const).flatMap((timezone) => {
        if (!Number.isFinite(measuredAt)) return [];
        const today = utcDay(measuredAt + (timezone === 'Asia/Seoul' ? 9 * 60 * 60 * 1000 : 0));
        const yesterday = utcDay(Date.parse(`${today}T00:00:00Z`) - 86400000);
        return [today, yesterday].map((date) => `${timezone}|${date}`);
      }),
    );
    if (
      observations.length !== 4 ||
      new Set(observations.map(observationKey)).size !== 4 ||
      !Number.isFinite(measuredAt) ||
      measuredAt > now + 60_000 ||
      observations.some((o) => {
        const start = windowStart(o.date, o.timezone);
        const end = start + 86400000;
        return (
          !expected.has(observationKey(o)) ||
          !o.timezone ||
          Date.parse(o.measuredAt) !== measuredAt ||
          Date.parse(o.windowStart ?? '') !== start ||
          Date.parse(o.windowEnd ?? '') !== end ||
          o.finalized !== measuredAt >= end ||
          !['authorized', 'denied', 'unavailable', 'pending'].includes(o.measurementStatus) ||
          (o.measurementStatus === 'authorized'
            ? !Number.isInteger(o.minutes) || o.minutes! < 0
            : o.minutes !== null)
        );
      })
    )
      throw new Error('INVALID_ANDROID_OBSERVATION');
    let reportFailed = false;
    try {
      await reportScreenTime(
        measurement.approved ? 'approved' : 'denied',
        null,
        generation,
        now,
        // 서로 다른 앱의 동시 사용 합계도 서버의 하루 1440분 계약 안으로 정규화한다.
        observations.map((o) => ({
          ...o,
          minutes: o.minutes === null ? null : Math.min(o.minutes, 1440),
        })),
      );
    } catch {
      reportFailed = true;
    }
    if (!current()) throw new Error('STALE_ACCOUNT');
    return { ...measurement, reportFailed };
  });
  measurementQueue = run.catch(() => undefined);
  return run;
}

// 네이티브 쓰기만 직렬화한다. 지연된 서버 조회가 종료·휴식 해제를 붙잡지 않는다.
let focusQueue: Promise<unknown> = Promise.resolve();
let focusRevision = 0;
export const ANDROID_FOCUS_LEASE_MS = 120_000;
export function syncAndroidFocus(
  session: Session | null,
  color: Color,
  _verifyServer = false,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (Platform.OS === 'android' && screenTimeNative?.supportsFocusShield === false)
    return Promise.resolve(true);
  const revision = ++focusRevision;
  const generation = sessionGeneration();
  const owner = getSession()?.userId;
  const current = () =>
    revision === focusRevision &&
    generation === sessionGeneration() &&
    owner === getSession()?.userId &&
    isCurrent();
  const write = (action: () => Promise<boolean>) => {
    const run = focusQueue.then(() => (current() ? action() : true));
    focusQueue = run.catch(() => undefined);
    return run;
  };
  const clear = () =>
    write(async () => {
      await screenTimeNative?.endAndroidFocus?.();
      return true;
    });
  return (async () => {
    if (!current()) return true;
    if (!owner || session?.status !== 'active') return clear();
    try {
      // 접근성만 쓰는 사용자는 측정 권한 여부와 무관하게 집중 복귀를 쓸 수 있다.
      const access = await screenTimeNative?.getAndroidFocusAccess?.(owner);
      if (!current()) return true;
      if (
        access &&
        (!access.consented || !access.configured || !access.connected || !access.enabled)
      )
        return clear();
      // 로컬 캐시만으로 임대를 늘리지 않는다. active 세션은 매번 서버 정본을 확인한다.
      const began = performance.now();
      const view = await currentFocusSession();
      if (!current()) return true;
      if (!view || view.status !== 'active' || view.id !== session.id) return clear();
      const remainingMs = ANDROID_FOCUS_LEASE_MS - (performance.now() - began);
      if (remainingMs <= 0) return clear();
      const confirmed: Session = {
        id: view.id,
        islandId: view.islandId,
        subject: view.subject,
        status: view.status,
        seconds: view.activeSeconds,
        startedAt: Date.parse(view.serverNow),
        version: view.version,
      };
      return await write(async () => {
        await screenTimeNative?.bindMeasurementOwner?.(owner);
        if (!current()) return true;
        if (confirmed.version == null || !screenTimeNative?.syncAndroidFocus) return false;
        return screenTimeNative.syncAndroidFocus(
          JSON.stringify({
            ...buildLiveActivityPayload(confirmed, color),
            owner,
            version: confirmed.version,
            remainingMs: Math.max(0, ANDROID_FOCUS_LEASE_MS - (performance.now() - began)),
          }),
        );
      });
    } catch (error) {
      if (!current()) return true;
      // 일시 오류는 즉시 비활성화하되 다음 앱 전환의 정본 재확인 경로를 남긴다.
      await write(async () => {
        if (screenTimeNative?.expireAndroidFocus) await screenTimeNative.expireAndroidFocus();
        else await screenTimeNative?.endAndroidFocus?.();
        return true;
      });
      throw error;
    }
  })();
}
