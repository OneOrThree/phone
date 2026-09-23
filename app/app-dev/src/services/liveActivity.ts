import { NativeModules, Platform } from 'react-native';
import type { Color, Session } from '@/services/model';

export type LiveActivityPayload = {
  sessionId: string;
  phase: 'focus' | 'rest';
  subject: string;
  catColor: Color;
  anchorMs: number;
  focusCount?: number;
  restCount?: number;
};

type NativeLiveActivity = {
  sync(payload: LiveActivityPayload): Promise<boolean>;
  endAll(): Promise<void>;
};

const native: NativeLiveActivity | undefined =
  Platform.OS === 'ios' ? NativeModules.LiveActivityModule : undefined;

// 빠른 휴식·복귀·종료 조작에서도 ActivityKit 상태 변경 순서를 유지한다.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}

export function syncLiveActivity(
  session: Session | null,
  color: Color,
  counts?: { focus: number; rest: number } | null,
): Promise<boolean | void> {
  if (!native) return Promise.resolve();
  if (!session) return enqueue(() => native.endAll());
  return enqueue(() => native.sync(buildLiveActivityPayload(session, color, counts)));
}

export function buildLiveActivityPayload(
  session: Session,
  color: Color,
  counts?: { focus: number; rest: number } | null,
): LiveActivityPayload {
  const rest = session.status === 'paused';
  return {
    sessionId: session.id,
    phase: rest ? 'rest' : 'focus',
    subject: rest ? '' : session.subject,
    catColor: color,
    anchorMs: rest
      ? (session.restStartedAt ?? Date.now())
      : session.startedAt - session.seconds * 1000,
    ...(counts ? (rest ? { restCount: counts.rest } : { focusCount: counts.focus }) : {}),
  };
}

export const endLiveActivities = (): Promise<void> =>
  native ? enqueue(() => native.endAll()) : Promise.resolve();
