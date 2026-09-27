import assert from 'node:assert/strict';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { ApiError } from '@/services/api/client';
import { blockUser, submitReport } from '@/services/api/safety';
import { isUserBlocked, replaceBlockedUsers } from '@/services/blockedUsers';

jest.mock('@/services/api/safety', () => ({
  blockUser: jest.fn(),
  submitReport: jest.fn(),
}));

const blockMock = blockUser as jest.Mock;
const reportMock = submitReport as jest.Mock;

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
  replaceBlockedUsers([]);
});

test('신고 화면은 회신용 이메일임을 안내하고 기타 사유의 설명을 필수로 검사한다', async () => {
  const screen = await render(<UserSafetySheet {...props()} />);

  await fireEvent.press(screen.getByText('신고하기'));
  assert.ok(screen.getByText('처리 결과를 회신받을 이메일 (선택)'));
  assert.ok(screen.getByText(/신고 처리 결과를 안내받고 싶을 때/));

  await fireEvent.press(screen.getByText('기타'));
  await fireEvent.press(screen.getByText('신고 접수'));

  assert.ok(screen.getByText('기타 사유를 설명해 주세요.'));
  assert.equal(reportMock.mock.calls.length, 0);
});

test('신고 성공은 입력을 정리해 보내고 동시 차단을 즉시 로컬 필터에 반영한다', async () => {
  reportMock.mockResolvedValue({ caseId: 'GR-1976', blocked: true });
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.changeText(screen.getByLabelText('신고 설명'), '  반복 연락  ');
  await fireEvent.changeText(
    screen.getByLabelText('처리 결과를 회신받을 이메일'),
    '  reply@example.com  ',
  );
  await fireEvent.press(screen.getByRole('switch', { name: '이 사용자도 차단' }));
  await fireEvent.press(screen.getByText('신고 접수'));

  await waitFor(() => assert.equal(reportMock.mock.calls.length, 1));
  assert.deepEqual(reportMock.mock.calls[0][0], {
    targetType: 'USER',
    targetId: 'user-2',
    reason: 'HARASSMENT',
    description: '반복 연락',
    replyEmail: 'reply@example.com',
    blockUser: true,
  });
  assert.equal(typeof reportMock.mock.calls[0][1], 'string');
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '신고가 접수됐어요. 사건 번호 GR-1976');
});

test('신고 실패는 시트를 닫거나 차단하지 않고 서버 오류를 보여 준다', async () => {
  reportMock.mockRejectedValue(new ApiError('SERVICE_UNAVAILABLE', '메일 확인에 실패했어요.', 503));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('신고하기'));
  await fireEvent.press(screen.getByText('신고 접수'));

  await waitFor(() => assert.ok(screen.getByText('메일 확인에 실패했어요.')));
  assert.equal(callbacks.onClose.mock.calls.length, 0);
  assert.equal(callbacks.onChanged.mock.calls.length, 0);
  assert.equal(isUserBlocked('user-2'), false);
});

test('신고 실패 후 재시도하면 같은 requestId로 복구한다', async () => {
  reportMock
    .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', '잠시 후 다시 시도해 주세요.', 503))
    .mockResolvedValueOnce({ caseId: 'GR-RETRY', blocked: false });
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);
  await fireEvent.press(screen.getByText('신고하기'));

  await fireEvent.press(screen.getByText('신고 접수'));
  await waitFor(() => assert.ok(screen.getByText('잠시 후 다시 시도해 주세요.')));
  const firstRequestId = reportMock.mock.calls[0][1];
  await fireEvent.press(screen.getByText('신고 접수'));

  await waitFor(() => assert.equal(callbacks.onClose.mock.calls.length, 1));
  assert.equal(reportMock.mock.calls[1][1], firstRequestId);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '신고가 접수됐어요. 사건 번호 GR-RETRY');
});

test('신고 실패 후 payload를 수정하면 새 requestId로 제출한다', async () => {
  reportMock
    .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', '잠시 후 다시 시도해 주세요.', 503))
    .mockResolvedValueOnce({ caseId: 'GR-EDITED', blocked: false });
  const screen = await render(<UserSafetySheet {...props()} />);
  await fireEvent.press(screen.getByText('신고하기'));

  await fireEvent.press(screen.getByText('신고 접수'));
  await waitFor(() => assert.ok(screen.getByText('잠시 후 다시 시도해 주세요.')));
  const firstRequestId = reportMock.mock.calls[0][1];
  await fireEvent.changeText(screen.getByLabelText('신고 설명'), '추가 설명');
  await fireEvent.press(screen.getByText('신고 접수'));

  await waitFor(() => assert.equal(reportMock.mock.calls.length, 2));
  assert.notEqual(reportMock.mock.calls[1][1], firstRequestId);
  assert.equal(reportMock.mock.calls[1][0].description, '추가 설명');
});

test('신고 접수 중 연타해도 메일 접수를 한 번만 요청한다', async () => {
  let finish: (value: { caseId: string; blocked: boolean }) => void = () => {};
  reportMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);
  await fireEvent.press(screen.getByText('신고하기'));

  const first = fireEvent.press(screen.getByText('신고 접수'));
  await waitFor(() => assert.equal(reportMock.mock.calls.length, 1));
  await fireEvent.press(screen.getByText('접수 확인 중…'));
  for (const close of screen.getAllByLabelText('닫기')) await fireEvent.press(close);
  assert.equal(reportMock.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 0);
  finish({ caseId: 'GR-ONCE', blocked: false });
  await first;
});

test('신고 사유는 44pt이고 처리 중에는 최초 payload로 잠긴다', async () => {
  let reject: (error: unknown) => void = () => {};
  reportMock
    .mockReturnValueOnce(new Promise((_, rejectPromise) => (reject = rejectPromise)))
    .mockResolvedValueOnce({ caseId: 'GR-RETRY', blocked: false });
  const screen = await render(<UserSafetySheet {...props()} />);
  await fireEvent.press(screen.getByText('신고하기'));

  const harassment = screen.getByRole('button', { name: '욕설·괴롭힘' });
  assert.equal(harassment.props.style.height, 44);
  const first = fireEvent.press(screen.getByText('신고 접수'));
  await waitFor(() => assert.equal(reportMock.mock.calls.length, 1));

  const hate = screen.getByRole('button', { name: '혐오·차별' });
  assert.equal(hate.props.accessibilityState.disabled, true);
  await fireEvent.press(hate);
  reject(new ApiError('SERVICE_UNAVAILABLE', '다시 시도해 주세요.', 400));
  await first;
  await waitFor(() => assert.ok(screen.getByText('다시 시도해 주세요.')));
  await fireEvent.press(screen.getByText('신고 접수'));

  await waitFor(() => assert.equal(reportMock.mock.calls.length, 2));
  assert.equal(reportMock.mock.calls[0][0].reason, 'HARASSMENT');
  assert.equal(reportMock.mock.calls[1][0].reason, 'HARASSMENT');
});

test('직접 차단 성공은 API 확인 뒤 로컬 필터와 완료 콜백을 갱신한다', async () => {
  blockMock.mockResolvedValue(undefined);
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('차단하기'));
  await fireEvent.press(screen.getByText('차단'));

  assert.equal(blockMock.mock.calls[0][0], 'user-2');
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '민지님을 차단했어요.');
});
