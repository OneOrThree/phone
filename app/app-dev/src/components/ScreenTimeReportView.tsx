import React, { useEffect, useState } from 'react';
import { Platform, requireNativeComponent, UIManager, View, type ViewProps } from 'react-native';
import { Txt } from '@/design-system/patterns';
import { screenTimeNative } from '@/services/ScreenTimeModule';
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
        <Txt kind="meta">사용량 리포트를 사용할 수 없어요</Txt>
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
    const generation = sessionGeneration();
    setReport(null);
    setFailed(false);
    const read = async () => {
      const owner = getSession()?.userId;
      if (!owner || !screenTimeNative?.getAndroidUsageBreakdown) throw new Error('UNAVAILABLE');
      const value = await screenTimeNative.getAndroidUsageBreakdown(owner, dayOffset);
      if (active && generation === sessionGeneration()) setReport(value);
    };
    void read().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [dayOffset]);
  return (
    <View {...props}>
      {failed ? (
        <Txt kind="meta">사용량을 확인하지 못했어요. 측정 권한과 앱 선택을 확인해 주세요.</Txt>
      ) : !report ? (
        <Txt kind="meta">사용량 확인 중…</Txt>
      ) : (
        <>
          <Txt>총 {Math.floor(report.totalSeconds / 60)}분</Txt>
          {report.apps.slice(0, 5).map((app) => (
            <Txt key={app.packageName} kind="meta">
              {app.label} · {Math.floor(app.seconds / 60)}분
            </Txt>
          ))}
        </>
      )}
    </View>
  );
}
