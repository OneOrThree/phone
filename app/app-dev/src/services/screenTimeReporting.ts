import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, uuid } from './api/client';
import { getSession, sessionGeneration } from './api/session';
import { putScreenTime, screenTimeDeviceId } from './api/screenTime';
import { screenTimeObservationReported } from './screenTimeEvents';
import type { ScreenTimeAuthorization, UsageTimeline } from './ScreenTimeModule';
import {
  buildScreenTimeObservations,
  reportDeadline,
  type ScreenTimeObservation,
} from './screenTimeWindow';

const PREFIX = 'gromo:screenTimeReporting:v1:';
type Consent = { version: 1; enabled: boolean };
type Pending = { observation: ScreenTimeObservation; key: string };
type Journal = {
  pending: Pending[];
  sent: Record<string, string>;
  rejected?: Record<string, string>;
};
let queue: Promise<unknown> = Promise.resolve();
let consentRevision = 0;
const listeners = new Set<() => void>();
export const subscribeScreenTimeReporting = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const consentKey = (userId: string) => `${PREFIX}consent:${userId}`;

export async function getScreenTimeReportingConsent(userId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(consentKey(userId));
  return raw ? (JSON.parse(raw) as Consent).enabled === true : false;
}

export async function setScreenTimeReportingConsent(userId: string, enabled: boolean) {
  consentRevision++;
  await AsyncStorage.setItem(consentKey(userId), JSON.stringify({ version: 1, enabled }));
  listeners.forEach((listener) => listener());
}

const fingerprint = (o: ScreenTimeObservation) => `${o.measurementStatus}:${o.minutes}`;

/** 보고 원장은 사용자·sid별로 격리한다. 실패 요청은 시각·키·본문을 그대로 재전송한다. */
export function reportScreenTime(
  authorization: ScreenTimeAuthorization,
  timeline: UsageTimeline | null,
  expectedGeneration: number,
  now = Date.now(),
): Promise<void> {
  const session = getSession();
  const deviceId = session && screenTimeDeviceId(session.accessToken);
  if (!session || !deviceId || sessionGeneration() !== expectedGeneration) return Promise.resolve();
  const revision = consentRevision;
  const current = () =>
    sessionGeneration() === expectedGeneration &&
    getSession()?.userId === session.userId &&
    screenTimeDeviceId(getSession()?.accessToken ?? '') === deviceId &&
    revision === consentRevision;
  const run = queue.then(async () => {
    if (!current()) return;
    const consentRaw = await AsyncStorage.getItem(consentKey(session.userId));
    // 동의한 적 없는 계정은 상태 보고도 보내지 않는다. 철회는 denied만 보낸다.
    if (!consentRaw || !current()) return;
    const consent = JSON.parse(consentRaw) as Consent;
    const key = `${PREFIX}queue:${session.userId}:${deviceId}`;
    const raw = await AsyncStorage.getItem(key);
    const journal: Journal = raw ? JSON.parse(raw) : { pending: [], sent: {} };
    if (!current()) return;
    const observations = buildScreenTimeObservations(
      consent.enabled ? authorization : 'denied',
      timeline,
      now,
    );
    const revoked = !consent.enabled || authorization !== 'approved';
    journal.pending = journal.pending.filter(
      (p) =>
        now <= reportDeadline(p.observation.date) &&
        (!revoked || p.observation.measurementStatus === 'denied'),
    );
    for (const observation of observations) {
      if (journal.sent[observation.date] === fingerprint(observation)) {
        journal.pending = journal.pending.filter((p) => p.observation.date !== observation.date);
        continue;
      }
      if (journal.rejected?.[observation.date] === fingerprint(observation))
        throw new Error('스크린타임 보고가 서버에서 거절됐어요.');
      const pending = journal.pending.find((p) => p.observation.date === observation.date);
      if (pending && fingerprint(pending.observation) === fingerprint(observation)) continue;
      // 상태가 달라졌으면 과거 숫자를 먼저 보내지 않고 최신 상태로 대체한다.
      journal.pending = journal.pending.filter((p) => p.observation.date !== observation.date);
      journal.pending.push({ observation, key: uuid() });
    }
    journal.sent = Object.fromEntries(
      Object.entries(journal.sent).filter(([date]) => now <= reportDeadline(date)),
    );
    await AsyncStorage.setItem(key, JSON.stringify(journal));
    for (const pending of [...journal.pending]) {
      if (!current()) return;
      try {
        await putScreenTime(pending.observation, deviceId, pending.key, expectedGeneration);
      } catch (error) {
        if (!current()) return;
        if (
          !(error instanceof ApiError) ||
          error.status === 0 ||
          error.status >= 500 ||
          error.status === 429
        )
          throw error;
        // 영구 오류는 같은 관측의 무한 재시도를 막고 UI에 실패를 전달한다.
        journal.pending = journal.pending.filter((p) => p.key !== pending.key);
        (journal.rejected ??= {})[pending.observation.date] = fingerprint(pending.observation);
        await AsyncStorage.setItem(key, JSON.stringify(journal));
        throw error;
      }
      if (!current()) return;
      journal.pending = journal.pending.filter((p) => p.key !== pending.key);
      journal.sent[pending.observation.date] = fingerprint(pending.observation);
      await AsyncStorage.setItem(key, JSON.stringify(journal));
      if (current()) screenTimeObservationReported();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
