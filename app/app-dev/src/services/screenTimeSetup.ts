import { screenTime, selectionCount, type ScreenTimeSelection } from './screenTime';

import { Platform } from 'react-native';
import { screenTimeNative } from './ScreenTimeModule';
import { screenTimeMeasurementChanged } from './screenTimeEvents';

export const screenTimeGuideVersion = () =>
  Platform.OS === 'android' && screenTimeNative?.getAndroidFocusAccess ? 2 : 1;
export type ScreenTimeSetupMode = 'setup' | 'measurement';
export type MeasurementReady = (minutes: number, unconfirmedDays: string[]) => void;

/** 저장된 네이티브 선택을 기준으로 중단된 단계를 재개한다. 0개 허용도 유효한 저장이다. */
export async function configureIOSScreenTime({
  mode,
  current,
  onMeasurementReady,
  onMeasurementSaved,
}: {
  mode: ScreenTimeSetupMode;
  current: () => boolean;
  onMeasurementReady?: MeasurementReady;
  onMeasurementSaved?: (selection: ScreenTimeSelection) => void;
}): Promise<boolean> {
  const allowed = await screenTime.getAllowedSelectionCounts();
  if (!current()) return false;
  const measurement = await screenTime.getMeasurementSelectionCounts();
  if (!current()) return false;
  const activate = async () => {
    if (!(await screenTime.promoteSelection())) throw new Error('measurement activation failed');
    if (!current()) return;
    const days = await screenTime.getUnconfirmedUsageBucketDays();
    if (!current()) return;
    const minutes = await screenTime.getTodayUsageBucketMinutes();
    if (current()) onMeasurementReady?.(minutes, days);
  };
  // 첫 저장 직후 종료되거나 모니터 등록이 실패한 경우도 다음 설정에서 복구한다.
  if (
    measurement?.pendingSelection &&
    !measurement.pendingSelection.pending &&
    selectionCount(measurement) === 0
  ) {
    await activate();
    if (!current()) return false;
    screenTimeMeasurementChanged();
  }
  if (!measurement || mode === 'measurement') {
    const picked = await screenTime.presentAppPicker();
    if (!current() || !picked) return false;
    if (picked.appliesImmediately) {
      await activate();
      if (!current()) return false;
    }
    onMeasurementSaved?.(picked);
    screenTimeMeasurementChanged();
    // 한 네이티브 시트의 dismiss가 끝난 다음 다음 시트를 연다.
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    if (!current()) return false;
  }
  // 기록에서 기존 측정 목록만 수정했으면 허용 목록을 다시 편집하지 않는다.
  if (mode === 'measurement' && allowed !== null) return true;
  const saved = await screenTime.presentAllowedAppManager();
  return current() && saved !== null;
}
