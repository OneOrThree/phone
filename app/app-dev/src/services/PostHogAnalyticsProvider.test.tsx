import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { PostHogAnalyticsProvider } from './PostHogAnalyticsProvider';
import { getPostHogClient } from './posthog';

jest.mock('./posthog', () => ({ getPostHogClient: jest.fn() }));
const mockProvider = jest.fn(({ children }: { children: React.ReactNode }) => children);
jest.mock('posthog-react-native', () => ({
  PostHogProvider: (props: { children: React.ReactNode }) => mockProvider(props),
}));

beforeEach(() => jest.clearAllMocks());

test('수집 제외 빌드에서는 SDK Provider 없이 앱을 표시한다', async () => {
  jest.mocked(getPostHogClient).mockReturnValue(null);
  const view = await render(
    <PostHogAnalyticsProvider>
      <Text>앱 화면</Text>
    </PostHogAnalyticsProvider>,
  );
  expect(view.getByText('앱 화면')).toBeTruthy();
  expect(mockProvider).not.toHaveBeenCalled();
});

test('기존 클라이언트로 터치를 수집하고 화면 중복 수집과 화면 텍스트 전송을 막는다', async () => {
  const client = {} as NonNullable<ReturnType<typeof getPostHogClient>>;
  jest.mocked(getPostHogClient).mockReturnValue(client);
  await render(
    <PostHogAnalyticsProvider>
      <Text>비공개 편지 본문</Text>
    </PostHogAnalyticsProvider>,
  );
  expect(mockProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      client,
      autocapture: {
        captureTouches: true,
        captureScreens: false,
        customLabelProp: 'testID',
        propsToCapture: ['testID'],
      },
    }),
  );

  // 실제 SDK의 터치 직렬화 결과에 화면 본문·입력값이 섞이지 않는지 확인한다.
  const { autocaptureFromTouchEvent } = jest.requireActual(
    require.resolve('posthog-react-native').replace(/index\.js$/, 'autocapture.js'),
  );
  const capture = jest.fn();
  const options = (mockProvider.mock.calls[0][0] as any).autocapture;
  autocaptureFromTouchEvent(
    {
      _targetInst: {
        elementType: { displayName: 'Pressable' },
        memoizedProps: {
          testID: 'send-letter',
          children: '비공개 편지 본문',
          accessibilityLabel: '친구 이름',
          value: '입력한 내용',
        },
        return: {
          elementType: { displayName: 'View' },
          memoizedProps: { testID: 'PostHogProvider' },
        },
      },
      nativeEvent: { pageX: 10, pageY: 20 },
    },
    { autocapture: capture },
    options,
  );
  expect(capture).toHaveBeenCalled();
  expect(capture.mock.calls[0][1][0].tag_name).toBe('send-letter');
  const payload = JSON.stringify(capture.mock.calls);
  expect(payload).toContain('send-letter');
  expect(payload).not.toMatch(/비공개|친구 이름|입력한 내용/);
});
