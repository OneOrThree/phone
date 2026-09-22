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
};

export type PreviousUsageBucket = {
  date: string;
  minutes: number;
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

type AndroidMethods = {
  openUsageAccessSettings(): Promise<boolean>;
  getUsageSnapshot(): Promise<AndroidUsageSnapshot>;
};

export const screenTimeNative = (
  Platform.OS === 'android'
    ? requireOptionalNativeModule('ScreenTimeModule')
    : Platform.OS === 'ios'
      ? NativeModules.ScreenTimeModule
      : undefined
) as Partial<ScreenTimeNativeModule & AndroidMethods> | undefined;
