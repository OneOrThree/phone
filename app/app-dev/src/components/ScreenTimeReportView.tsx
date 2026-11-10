import { t } from '@/i18n';
import React, { useEffect, useState } from 'react';
import {
  AppState,
  Platform,
  requireNativeComponent,
  UIManager,
  View,
  type ViewProps,
} from 'react-native';
import { Txt } from '@/design-system/patterns';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { subscribeScreenTimeObservations } from '@/services/screenTimeEvents';
import { getSession, sessionGeneration } from '@/services/api/session';

export type ScreenTimeReportContext =
  'Total Activity' | 'Compact Activity' | 'Remaining Activity' | 'Home Usage';

export interface ScreenTimeReportViewProps extends ViewProps {
  reportContext?: ScreenTimeReportContext;
  goalSeconds?: number;
  dayOffset?: number;
}

let NativeReport: React.ComponentType<ScreenTimeReportViewProps> | undefined;

export default function ScreenTimeReportView({
  reportContext = 'Compact Activity',
  dayOffset = 0,
  goalSeconds = -1,
  ...props
}: ScreenTimeReportViewProps) {
  if (Platform.OS === 'android') return <AndroidReport dayOffset={dayOffset} {...props} />;
  if (Platform.OS !== 'ios' || !UIManager.getViewManagerConfig('ScreenTimeReportView')) {
    return (
      <View {...props}>
        <Txt kind="meta">{t('ui.screenTime.reportUnavailable')}</Txt>
      </View>
    );
  }
  NativeReport ??= requireNativeComponent<ScreenTimeReportViewProps>('ScreenTimeReportView');
  return (
    <NativeReport
      {...props}
      reportContext={reportContext}
      dayOffset={dayOffset}
      goalSeconds={goalSeconds}
    />
  );
}

function AndroidReport({ dayOffset = 0, ...props }: ScreenTimeReportViewProps) {
  const [report, setReport] = useState<{
    totalSeconds: number;
    apps: { packageName: string; label: string; seconds: number }[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    setReport(null);
    setFailed(false);
    const read = async () => {
      const seq = ++sequence;
      const generation = sessionGeneration();
      const owner = getSession()?.userId;
      const current = () => active && seq === sequence && generation === sessionGeneration();
      try {
        if (!owner || !screenTimeNative?.getAndroidUsageBreakdown) throw new Error('UNAVAILABLE');
        const value = await screenTimeNative.getAndroidUsageBreakdown(owner, dayOffset);
        if (current()) {
          setReport(value);
          setFailed(false);
        }
      } catch {
        if (current()) {
          setReport(null);
          setFailed(true);
        }
      }
    };
    void read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    const unsubscribe = subscribeScreenTimeObservations(() => {
      void read();
    });
    return () => {
      active = false;
      subscription.remove();
      unsubscribe();
    };
  }, [dayOffset]);
  return (
    <View {...props}>
      {failed ? (
        <Txt kind="meta">{t('ui.screenTime.reportFailed')}</Txt>
      ) : !report ? (
        <Txt kind="meta">{t('ui.screenTime.reportLoading')}</Txt>
      ) : (
        <>
          <Txt>{t('ui.screenTime.totalMinutes', { v0: Math.floor(report.totalSeconds / 60) })}</Txt>
          {report.apps.slice(0, 5).map((app) => (
            <Txt key={app.packageName} kind="meta">
              {t('ui.screenTime.appMinutes', { v0: app.label, v1: Math.floor(app.seconds / 60) })}
            </Txt>
          ))}
        </>
      )}
    </View>
  );
}
