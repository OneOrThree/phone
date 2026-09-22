import React from 'react';
import { Platform, requireNativeComponent, UIManager, View, type ViewProps } from 'react-native';
import { Txt } from '@/design-system/patterns';

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
