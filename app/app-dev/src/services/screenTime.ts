import { NativeModules, Platform } from 'react-native';

export type ScreenTimeAuthorization = 'approved' | 'denied' | 'notDetermined' | 'unavailable';

export type ScreenTimeSelection = {
  applications: number;
  categories: number;
  webDomains: number;
  selectionSignature?: string;
  dismissed?: boolean;
};

type ScreenTimeNativeModule = {
  requestAuthorization(): Promise<boolean>;
  getAuthorizationStatus(): Promise<ScreenTimeAuthorization>;
  getMeasurementSelectionCounts(): Promise<ScreenTimeSelection | null>;
  presentAppPicker(): Promise<ScreenTimeSelection | null>;
  promoteSelection(): Promise<boolean>;
  setPendingSelectionApplyDate(dateString: string): Promise<boolean>;
  startUsageBucketMonitoring(maxMinutes: number): Promise<boolean>;
  getTodayUsageBucketMinutes(): Promise<number>;
  presentAllowedAppManager(): Promise<ScreenTimeSelection | null>;
  getAllowedSelectionCounts(): Promise<ScreenTimeSelection | null>;
  setFocusAllowSafariWeb(allowed: boolean): Promise<void>;
  getFocusAllowSafariWeb(): Promise<boolean>;
  startFocusShield(subjectName: string): Promise<boolean>;
  stopFocusShield(): Promise<void>;
};

const nativeModule = NativeModules.ScreenTimeModule as ScreenTimeNativeModule | undefined;

export const isScreenTimeAvailable = Platform.OS === 'ios' && !!nativeModule;

const unavailable = (): ScreenTimeAuthorization => 'unavailable';

export const screenTime = {
  requestAuthorization: () => nativeModule?.requestAuthorization() ?? Promise.resolve(false),
  getAuthorizationStatus: () =>
    nativeModule?.getAuthorizationStatus() ?? Promise.resolve(unavailable()),
  getMeasurementSelectionCounts: () =>
    nativeModule?.getMeasurementSelectionCounts() ?? Promise.resolve(null),
  presentAppPicker: () => nativeModule?.presentAppPicker() ?? Promise.resolve(null),
  promoteSelection: () => nativeModule?.promoteSelection() ?? Promise.resolve(false),
  setPendingSelectionApplyDate: (dateString: string) =>
    nativeModule?.setPendingSelectionApplyDate(dateString) ?? Promise.resolve(false),
  startUsageBucketMonitoring: (maxMinutes = 900) =>
    nativeModule?.startUsageBucketMonitoring(maxMinutes) ?? Promise.resolve(false),
  getTodayUsageBucketMinutes: () =>
    nativeModule?.getTodayUsageBucketMinutes() ?? Promise.resolve(0),
  presentAllowedAppManager: () => nativeModule?.presentAllowedAppManager() ?? Promise.resolve(null),
  getAllowedSelectionCounts: () =>
    nativeModule?.getAllowedSelectionCounts() ?? Promise.resolve(null),
  setFocusAllowSafariWeb: (allowed: boolean) =>
    nativeModule?.setFocusAllowSafariWeb(allowed) ?? Promise.resolve(),
  getFocusAllowSafariWeb: () => nativeModule?.getFocusAllowSafariWeb() ?? Promise.resolve(false),
  startFocusShield: (subjectName: string) =>
    nativeModule?.startFocusShield(subjectName) ?? Promise.resolve(false),
  stopFocusShield: () => nativeModule?.stopFocusShield() ?? Promise.resolve(),
};

export const selectionCount = (selection: ScreenTimeSelection | null) =>
  selection ? selection.applications + selection.categories + selection.webDomains : 0;
