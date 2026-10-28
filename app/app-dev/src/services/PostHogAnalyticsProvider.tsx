import type { ReactNode } from 'react';
import { getPostHogClient } from './posthog';

const autocapture = {
  captureTouches: true,
  // 앱의 커스텀 라우터가 trackPostHogScreen으로 화면 전환을 기록한다.
  captureScreens: false,
  // 기존 버튼 식별자를 재사용해 콘솔에서 어떤 요소를 눌렀는지 구분한다.
  customLabelProp: 'testID',
  // children·accessibilityLabel에는 편지 본문이나 사용자 입력이 들어갈 수 있다.
  propsToCapture: ['testID'],
};

export function PostHogAnalyticsProvider({ children }: { children: ReactNode }) {
  const client = getPostHogClient();
  // 개발·목업 또는 초기화 실패 시 Provider가 새 클라이언트를 만들지 않게 한다.
  if (!client) return <>{children}</>;

  const { PostHogProvider } =
    require('posthog-react-native') as typeof import('posthog-react-native');
  return (
    <PostHogProvider client={client} autocapture={autocapture}>
      {children}
    </PostHogProvider>
  );
}
