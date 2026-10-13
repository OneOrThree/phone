import { currentFocusSession } from './api/focusSessions';
import { screenTimeNative } from './ScreenTimeModule';
import { getSession, sessionGeneration } from './api/session';
import { reportScreenTime } from './screenTimeReporting';
import { observationKey, utcDay, windowStart } from './screenTimeWindow';
import type { Session, Color } from './model';
import { buildLiveActivityPayload, REST_AUTO_CLOSE_MS } from './liveActivity';

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
        observations,
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

let focusQueue: Promise<unknown> = Promise.resolve();
let focusRevision = 0;
export function syncAndroidFocus(
  session: Session | null,
  color: Color,
  verifyServer = false,
): Promise<boolean> {
  const revision = ++focusRevision;
  const generation = sessionGeneration();
  const owner = getSession()?.userId;
  const run = focusQueue.then(async () => {
    if (revision !== focusRevision || generation !== sessionGeneration()) return true;
    let confirmed = session;
    if (owner && verifyServer) {
      const view = await currentFocusSession();
      if (revision !== focusRevision || generation !== sessionGeneration()) return true;
      confirmed = view
        ? {
            id: view.id,
            islandId: view.islandId,
            subject: view.subject,
            status: view.status,
            seconds: view.activeSeconds,
            startedAt: Date.parse(view.serverNow),
            version: view.version,
            ...(view.restStartedAt ? { restStartedAt: Date.parse(view.restStartedAt) } : {}),
          }
        : null;
    }
    if (!confirmed || !owner) {
      await screenTimeNative?.endAndroidFocus?.();
      return true;
    }
    if (confirmed.version == null || !screenTimeNative?.syncAndroidFocus) return false;
    await screenTimeNative.bindMeasurementOwner?.(owner);
    if (revision !== focusRevision || generation !== sessionGeneration()) return true;
    const payload = buildLiveActivityPayload(confirmed, color);
    return screenTimeNative.syncAndroidFocus(
      JSON.stringify({
        ...payload,
        owner,
        version: confirmed.version,
        validUntilMs:
          confirmed.status === 'paused'
            ? (confirmed.restStartedAt ?? Date.now()) + REST_AUTO_CLOSE_MS
            : 0, // 집중은 서버 세션 종료까지 유지하고 휴식만 한 시간 뒤 만료한다.
      }),
    );
  });
  focusQueue = run.catch(() => undefined);
  return run;
}
