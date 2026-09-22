import { syncAndroidScreenTime } from './screentimeSync';
import { Platform } from 'react-native';
import {
  screenTimeNative as nativeModule,
  type ScreenTimeAuthorization,
  type ScreenTimeSelection,
} from './ScreenTimeModule';
export type {
  ScreenTimeAuthorization,
  ScreenTimeSelection,
  PreviousUsageBucket,
} from './ScreenTimeModule';

export const isScreenTimeAvailable =
  (Platform.OS === 'ios' || Platform.OS === 'android') && !!nativeModule;

const unavailable = (): ScreenTimeAuthorization => 'unavailable';

export const screenTime = {
  openUsageAccessSettings: () =>
    nativeModule?.openUsageAccessSettings?.() ?? Promise.resolve(false),
  requestAuthorization: () => nativeModule?.requestAuthorization?.() ?? Promise.resolve(false),
  getAuthorizationStatus: () =>
    nativeModule?.getAuthorizationStatus?.() ?? Promise.resolve(unavailable()),
  getMeasurementSelectionCounts: () =>
    nativeModule?.getMeasurementSelectionCounts?.() ?? Promise.resolve(null),
  presentAppPicker: () => nativeModule?.presentAppPicker?.() ?? Promise.resolve(null),
  promoteSelection: () => nativeModule?.promoteSelection?.() ?? Promise.resolve(false),
  promotePendingSelectionIfDue: () =>
    nativeModule?.promotePendingSelectionIfDue?.() ?? Promise.resolve(false),
  startUsageBucketMonitoring: (maxMinutes = 900) =>
    nativeModule?.startUsageBucketMonitoring?.(maxMinutes) ?? Promise.resolve(false),
  getTodayUsageBucketMinutes: () =>
    nativeModule?.getTodayUsageBucketMinutes?.() ?? Promise.resolve(0),
  getPreviousUsageBucket: () => nativeModule?.getPreviousUsageBucket?.() ?? Promise.resolve(null),
  getUsageBucketHistory: () => nativeModule?.getUsageBucketHistory?.() ?? Promise.resolve([]),
  markCurrentUsageBucketUnconfirmed: () =>
    nativeModule?.markCurrentUsageBucketUnconfirmed?.() ?? Promise.resolve([]),
  getUnconfirmedUsageBucketDays: () =>
    nativeModule?.getUnconfirmedUsageBucketDays?.() ?? Promise.resolve([]),
  resetScreenTimeData: async () => {
    if (Platform.OS === 'android') await syncAndroidScreenTime.reset();
    await nativeModule?.resetScreenTimeData?.();
  },
  presentAllowedAppManager: () =>
    nativeModule?.presentAllowedAppManager?.() ?? Promise.resolve(null),
  getAllowedSelectionCounts: () =>
    nativeModule?.getAllowedSelectionCounts?.() ?? Promise.resolve(null),
  setFocusAllowSafariWeb: (allowed: boolean) =>
    nativeModule?.setFocusAllowSafariWeb?.(allowed) ?? Promise.resolve(),
  getFocusAllowSafariWeb: () => nativeModule?.getFocusAllowSafariWeb?.() ?? Promise.resolve(false),
  startFocusShield: (subjectName: string) =>
    nativeModule?.startFocusShield?.(subjectName) ?? Promise.resolve(false),
  stopFocusShield: () => nativeModule?.stopFocusShield?.() ?? Promise.resolve(),
};

export const selectionCount = (selection: ScreenTimeSelection | null) =>
  selection ? selection.applications + selection.categories + selection.webDomains : 0;
