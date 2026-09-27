import assert from 'node:assert/strict';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { blockUser, REPORT_EMAIL_RECIPIENT } from '@/services/api/safety';
import { isUserBlocked, replaceBlockedUsers } from '@/services/blockedUsers';

const mockAppLayout = {
  width: 402,
  height: 874,
  fontScale: 1,
  tablet: false,
  landscape: false,
  compact: false,
  contentWidth: 402,
  gutter: 20,
  floatingWidth: 362,
  modalWidth: 362,
  insets: { top: 52, bottom: 32, left: 0, right: 0 },
};

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => mockAppLayout,
}));

jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  blockUser: jest.fn(),
}));

const blockMock = blockUser as jest.Mock;
let openUrlMock: jest.SpyInstance;

type TestProps = React.ComponentProps<typeof UserSafetySheet> & {
  onClose: jest.Mock;
  onChanged: jest.Mock;
  onMessage: jest.Mock;
};

const props = (over: Partial<React.ComponentProps<typeof UserSafetySheet>> = {}): TestProps =>
  ({
    visible: true,
    targetUserId: 'user-2',
    targetName: '민지',
    reportTargetType: 'USER' as const,
    reportTargetId: 'user-2',
    onClose: jest.fn(),
    onChanged: jest.fn(),
    onMessage: jest.fn(),
    ...over,
  }) as TestProps;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAppLayout, {
    width: 402,
    height: 874,
    tablet: false,
    landscape: false,
    compact: false,
    modalWidth: 362,
  });
  replaceBlockedUsers([]);
  openUrlMock = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

test('태블릿에서는 신고 시트를 제한된 너비로 가운데 정렬한다', async () => {
  Object.assign(mockAppLayout, { width: 1024, height: 1366, tablet: true, modalWidth: 560 });

  const screen = await render(<UserSafetySheet {...props()} />);

  assert.equal(
    StyleSheet.flatten(screen.getByTestId('user-safety-layout').props.style).justifyContent,
    'center',
  );
  assert.equal(StyleSheet.flatten(screen.getByTestId('user-safety-panel').props.style).width, 560);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('신고 화면은 회신용 이메일임을 안내하고 기타 사유의 설명을 필수로 검사한다', async () => {
  const screen = await render(<UserSafetySheet {...props()} />);

  await fireEvent.press(screen.getByText('신고하기'));
  assert.ok(screen.getByText('처리 결과를 회신받을 이메일 (선택)'));
  assert.ok(screen.getByText(/운영팀의 답장을 받을 주소/));

  await fireEvent.press(screen.getByText('기타'));
  await fireEvent.press(screen.getByText('이메일 작성'));

  assert.ok(screen.getByText('기타 사유를 설명해 주세요.'));
  assert.equal(openUrlMock.mock.calls.length, 0);
});

test('신고 입력으로 운영 Gmail 메일 작성 화면을 열고 선택한 차단을 즉시 반영한다', async () => {
  blockMock.mockResolvedValue(undefined);
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.changeText(screen.getByLabelText('신고 설명'), '  반복 연락  ');
  await fireEvent.changeText(
    screen.getByLabelText('처리 결과를 회신받을 이메일'),
    '  reply@example.com  ',
  );
  await fireEvent.press(screen.getByRole('switch', { name: '이 사용자도 차단' }));
  await fireEvent.press(screen.getByText('이메일 작성'));

  await waitFor(() => assert.equal(openUrlMock.mock.calls.length, 1));
  const url = openUrlMock.mock.calls[0][0];
  assert.ok(url.startsWith(`mailto:${REPORT_EMAIL_RECIPIENT}?`));
  assert.ok(decodeURIComponent(url).includes('상세 설명: 반복 연락'));
  assert.ok(decodeURIComponent(url).includes('회신 받을 이메일: reply@example.com'));
  assert.equal(blockMock.mock.calls[0][0], 'user-2');
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(
    callbacks.onMessage.mock.calls[0][0],
    '차단했어요. 메일 내용을 확인한 뒤 보내 주세요.',
  );
});

test('메일 앱을 열지 못하면 시트를 유지하고 다시 시도할 수 있게 안내한다', async () => {
  openUrlMock.mockRejectedValueOnce(new Error('no mail app'));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.press(screen.getByText('이메일 작성'));

  await waitFor(() => assert.ok(screen.getByText(/처리하지 못했어요/)));
  assert.equal(callbacks.onClose.mock.calls.length, 0);
  assert.equal(isUserBlocked('user-2'), false);
});

test('선택 차단이 실패해도 실패 상태를 담아 신고 메일 작성은 계속한다', async () => {
  blockMock.mockRejectedValue(new Error('block unavailable'));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.press(screen.getByRole('switch', { name: '이 사용자도 차단' }));
  await fireEvent.press(screen.getByText('이메일 작성'));

  await waitFor(() => assert.equal(openUrlMock.mock.calls.length, 1));
  assert.ok(decodeURIComponent(openUrlMock.mock.calls[0][0]).includes('앱에서 함께 차단: 실패'));
  assert.equal(blockMock.mock.calls.length, 1);
  assert.equal(callbacks.onChanged.mock.calls.length, 0);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(
    callbacks.onMessage.mock.calls[0][0],
    '차단은 완료하지 못했어요. 신고 메일 내용을 확인한 뒤 보내 주세요.',
  );
});

test('선택 차단 뒤 메일 앱이 실패해도 시트를 유지해 재시도할 수 있다', async () => {
  blockMock.mockResolvedValue(undefined);
  openUrlMock.mockRejectedValueOnce(new Error('no mail app'));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.press(screen.getByRole('switch', { name: '이 사용자도 차단' }));
  await fireEvent.press(screen.getByText('이메일 작성'));

  await waitFor(() => assert.ok(screen.getByText(/차단은 완료했지만 메일 앱을 열지 못했어요/)));
  assert.equal(blockMock.mock.calls.length, 1);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 0);
  assert.equal(isUserBlocked('user-2'), true);
  assert.ok(screen.getByText('차단을 완료했어요.'));
  assert.ok(screen.getByText('이메일 작성'));

  await fireEvent.press(screen.getByText('이메일 작성'));

  await waitFor(() => assert.equal(openUrlMock.mock.calls.length, 2));
  assert.equal(blockMock.mock.calls.length, 1);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
});

test('메일 앱을 여는 동안 연타와 닫기를 막는다', async () => {
  let finish: () => void = () => {};
  openUrlMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);
  await fireEvent.press(screen.getByText('신고하기'));

  const first = fireEvent.press(screen.getByText('이메일 작성'));
  await waitFor(() => assert.equal(openUrlMock.mock.calls.length, 1));
  await fireEvent.press(screen.getByText('메일 여는 중…'));
  for (const close of screen.getAllByLabelText('닫기')) await fireEvent.press(close);
  assert.equal(openUrlMock.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 0);
  finish();
  await first;
});

test('신고 사유는 44pt이고 메일을 여는 동안 입력이 잠긴다', async () => {
  let finish: () => void = () => {};
  openUrlMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  const screen = await render(<UserSafetySheet {...props()} />);
  await fireEvent.press(screen.getByText('신고하기'));

  const harassment = screen.getByRole('button', { name: '욕설·괴롭힘' });
  assert.equal(harassment.props.style.height, 44);
  const first = fireEvent.press(screen.getByText('이메일 작성'));
  await waitFor(() => assert.equal(openUrlMock.mock.calls.length, 1));

  const hate = screen.getByRole('button', { name: '혐오·차별' });
  assert.equal(hate.props.accessibilityState.disabled, true);
  finish();
  await first;
});

test('직접 차단 성공은 API 확인 뒤 로컬 필터와 완료 콜백을 갱신한다', async () => {
  blockMock.mockResolvedValue(undefined);
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('차단하기'));
  assert.ok(screen.getByText(/내 화면에서 숨겨져요/));
  assert.ok(screen.getByText(/해제하면 다시 보일 수 있어요/));
  await fireEvent.press(screen.getByText('차단'));

  assert.equal(blockMock.mock.calls[0][0], 'user-2');
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '민지님을 차단했어요.');
});
