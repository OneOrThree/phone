import { screenTime, selectionCount } from './screenTime';
import { dayKey } from './model';
import { getSession, sessionGeneration } from './api/session';
import { ApiError, CLIENT_STALE_SESSION } from './api/client';

let queue: Promise<unknown> = Promise.resolve();

/** 네이티브 선택 승격·조회 순서를 고정하고 화면에는 완성된 스냅샷만 전달한다. */
export function syncIOSScreenTime(owner: string) {
  const generation = sessionGeneration();
  const check = () => {
    if (generation !== sessionGeneration() || getSession()?.userId !== owner)
      throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요.', 0);
  };
  const result = queue.then(async () => {
    check();
    await screenTime.bindMeasurementOwner(owner);
    check();
    const authorization = await screenTime.getAuthorizationStatus();
    check();
    const approved = authorization === 'approved';
    if (!approved) await screenTime.markCurrentUsageBucketUnconfirmed();
    check();
    if (approved) await screenTime.promotePendingSelectionIfDue();
    check();
    const selection = approved ? await screenTime.getMeasurementSelectionCounts() : null;
    check();
    const ready = approved && selectionCount(selection) > 0;
    if (ready && !(await screenTime.startUsageBucketMonitoring()))
      throw new Error('스크린타임 모니터를 등록하지 못했어요.');
    check();
    const [minutes, history, unconfirmedDays, timeline] = await Promise.all([
      ready ? screenTime.getTodayUsageBucketMinutes() : Promise.resolve(null),
      screenTime.getUsageBucketHistory(),
      screenTime.getUnconfirmedUsageBucketDays(),
      ready ? screenTime.getUsageTimeline() : Promise.resolve(null),
    ]);
    return {
      authorization,
      timeline,
      snapshot: {
        approved,
        date: dayKey(),
        minutes,
        history,
        unconfirmedDays: [...new Set([...unconfirmedDays, ...(timeline?.unconfirmedDays ?? [])])],
      },
    };
  });
  queue = result.catch(() => undefined);
  return result;
}
