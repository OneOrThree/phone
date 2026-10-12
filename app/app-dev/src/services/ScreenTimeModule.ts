// iOS는 RN 브리지, Android는 로컬 Expo 모듈을 사용한다.
import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type ScreenTimeAuthorization = 'approved' | 'denied' | 'notDetermined' | 'unavailable';

export type ScreenTimeSelection = {
  applications: number;
  categories: number;
  webDomains: number;
  selectionSignature?: string;
  dismissed?: boolean;
  appliesImmediately?: boolean;
  allApps?: boolean;
  pending?: boolean;
};

export type PreviousUsageBucket = {
  date: string;
  minutes: number;
};

export type UsageTimeline = {
  startedAt: number;
  observedAt: number;
  days: {
    date: string;
    startedAt: number;
    events: { bucket: number; firedAt: number }[];
  }[];
  unconfirmedDays: string[];
};

export type ScreenTimeNativeModule = {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<ScreenTimeAuthorization>;
  getMeasurementSelectionCounts(): Promise<ScreenTimeSelection | null>;
  presentAppPicker(): Promise<ScreenTimeSelection | null>;
  promoteSelection(): Promise<boolean>;
  promotePendingSelectionIfDue(): Promise<boolean>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  getPreviousUsageBucket(): Promise<PreviousUsageBucket | null>;
  getUsageBucketHistory(): Promise<PreviousUsageBucket[]>;
  bindMeasurementOwner(owner: string): Promise<void>;
  getUsageTimeline(): Promise<UsageTimeline | null>;
  markCurrentUsageBucketUnconfirmed(): Promise<string[]>;
  getUnconfirmedUsageBucketDays(): Promise<string[]>;
  resetScreenTimeData(): Promise<void>;
  presentAllowedAppManager(): Promise<ScreenTimeSelection | null>;
  getAllowedSelectionCounts(): Promise<ScreenTimeSelection | null>;
  setFocusAllowSafariWeb(allowed: boolean): Promise<void>;
  getFocusAllowSafariWeb(): Promise<boolean>;
  startFocusShield(subjectName: string): Promise<boolean>;
  stopFocusShield(): Promise<void>;
};

export type AndroidUsageSnapshot = {
  date: string;
  minutes: number;
  previousDate: string;
  previousMinutes: number;
};

export type AndroidSelection = {
  configured: boolean;
  allApps: boolean;
  packages: string[];
  pending: boolean;
};
export type InstalledApp = { packageName: string; label: string };
export type AndroidMeasurement = import('./screentimeSync').ScreenTimeSnapshot & {
  owner: string;
  observations: import('./screenTimeWindow').ScreenTimeObservation[];
};
type AndroidMethods = {
  openUsageAccessSettings(): Promise<boolean>;
  getUsageSnapshot(): Promise<AndroidUsageSnapshot>;
  getAndroidMeasurement(): Promise<AndroidMeasurement>;
  getAndroidSelection(): Promise<AndroidSelection>;
  setAndroidSelection(
    owner: string,
    packages: string[],
    allApps: boolean,
  ): Promise<AndroidSelection>;
  getInstalledApps(): Promise<InstalledApp[]>;
  getAppIcon(packageName: string): Promise<string | null>;
  setAndroidAllowedPackages(owner: string, packages: string[]): Promise<void>;
  getAllowedPackages(): Promise<string[]>;
  setAllowedPackages(packages: string[]): Promise<void>;
  canDrawOverlays(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  syncAndroidFocus(payload: string): Promise<boolean>;
  endAndroidFocus(): Promise<void>;
  getFocusPushToken(): Promise<string>;
  getUsageBreakdown(dayOffset: number): Promise<{
    totalSeconds: number;
    otherSeconds: number;
    apps: { packageName: string; label: string; seconds: number }[];
  }>;
  getAndroidUsageBreakdown(
    owner: string,
    dayOffset: number,
  ): ReturnType<AndroidMethods['getUsageBreakdown']>;
};

export const screenTimeNative = (
  Platform.OS === 'android'
    ? requireOptionalNativeModule('ScreenTimeModule')
    : Platform.OS === 'ios'
      ? NativeModules.ScreenTimeModule
      : undefined
) as Partial<ScreenTimeNativeModule & AndroidMethods> | undefined;
