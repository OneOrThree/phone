import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { getSession, sessionGeneration } from './api/session';
import type { Color } from './model';

export type HomeWidgetSnapshot = {
  owner: string;
  day: string;
  totalSeconds: number;
  catColor: Color;
  observedAt: number;
};
const native =
  Platform.OS === 'ios'
    ? NativeModules.LiveActivityModule
    : Platform.OS === 'android'
      ? requireOptionalNativeModule<{ updateHomeWidget(payload: string | null): Promise<void> }>(
          'StudyWidgetModule',
        )
      : undefined;
let queue: Promise<unknown> = Promise.resolve();
let revision = 0;

export function updateIOSHomeWidget(snapshot: HomeWidgetSnapshot | null): Promise<void> {
  const request = ++revision;
  const generation = sessionGeneration();
  const run = queue.then(async () => {
    if (
      snapshot &&
      (request !== revision ||
        generation !== sessionGeneration() ||
        getSession()?.userId !== snapshot.owner)
    )
      return;
    await native?.updateHomeWidget?.(snapshot ? JSON.stringify(snapshot) : null);
  });
  queue = run.catch(() => undefined);
  return run;
}
