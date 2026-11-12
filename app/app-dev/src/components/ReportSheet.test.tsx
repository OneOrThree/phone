import React from 'react';
import assert from 'node:assert/strict';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { ReportSheet } from './ReportSheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { submitReport } from '@/services/api/safety';
import { applyLocalePref } from '@/i18n';

jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  submitReport: jest.fn(),
}));
const wrapper = ({ children }: React.PropsWithChildren) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 44, bottom: 34, left: 0, right: 0 },
    }}
  >
    {children}
  </SafeAreaProvider>
);

const submit = submitReport as jest.Mock;
const target = {
  targetType: 'LETTER' as const,
  targetId: '11111111-2222-4333-8444-555555555555',
  targetUserId: '22222222-2222-4333-8444-555555555555',
  label: '친구',
  submittedText: '편지 원문',
};

beforeEach(() => {
  jest.clearAllMocks();
  applyLocalePref('ko');
});

test('실패 후 같은 내용은 같은 키로 재시도하고 서버 접수 번호 뒤에만 완료한다', async () => {
  submit
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ reportId: '접수번호', receivedAt: '2026-11-12T00:00:00Z' });
  const ui = await render(<ReportSheet visible target={target} onClose={jest.fn()} />, { wrapper });
  await fireEvent.press(ui.getByText('괴롭힘·욕설'));
  await fireEvent.changeText(
    ui.getByPlaceholderText('누구의 어떤 내용인지, 어디에서 있었던 일인지 알려주세요.'),
    '불쾌한 편지를 받았어요',
  );
  await fireEvent.press(ui.getByText('신고 접수하기'));
  await waitFor(() =>
    assert.ok(ui.getByText('처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.')),
  );
  assert.equal(ui.queryByText('신고를 접수했어요'), null);
  await fireEvent.press(ui.getByText('신고 접수하기'));
  await waitFor(() => assert.ok(ui.getByText('접수 번호: 접수번호')));
  assert.equal(submit.mock.calls[0][0].requestId, submit.mock.calls[1][0].requestId);
  assert.equal(submit.mock.calls[0][0].targetId, target.targetId);
  assert.equal(submit.mock.calls[0][0].submittedText, '편지 원문');
});

test('처리 중 중복 탭과 닫기를 막고 실패 뒤 설명 변경은 새 요청 키를 쓴다', async () => {
  let reject!: (reason: Error) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  submit.mockResolvedValueOnce({ reportId: '접수번호', receivedAt: '2026-11-12T00:00:00Z' });
  const close = jest.fn();
  const ui = await render(<ReportSheet visible onClose={close} />, { wrapper });
  await fireEvent.press(ui.getByText('기타'));
  const input = ui.getByPlaceholderText('누구의 어떤 내용인지, 어디에서 있었던 일인지 알려주세요.');
  await fireEvent.changeText(input, '첫 설명');
  await fireEvent.press(ui.getByText('신고 접수하기'));
  await fireEvent.press(ui.getByText('처리 중…'));
  await fireEvent.press(ui.getByLabelText('닫기'));
  assert.equal(submit.mock.calls.length, 1);
  assert.equal(close.mock.calls.length, 0);
  await act(async () => reject(new Error('offline')));
  await fireEvent.changeText(input, '수정한 설명');
  await fireEvent.press(ui.getByText('신고 접수하기'));
  await waitFor(() => assert.ok(ui.getByText('신고를 접수했어요')));
  assert.notEqual(submit.mock.calls[0][0].requestId, submit.mock.calls[1][0].requestId);
});

test('대상이 바뀌면 이전 접수 결과를 버리고 본문 발췌는 서버 한도를 지킨다', async () => {
  let resolve!: (value: { reportId: string; receivedAt: string }) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const ui = await render(
    <ReportSheet
      visible
      target={{ ...target, submittedText: 'x'.repeat(6000) }}
      onClose={jest.fn()}
    />,
    { wrapper },
  );
  await fireEvent.press(ui.getByText('기타'));
  await fireEvent.changeText(
    ui.getByPlaceholderText('누구의 어떤 내용인지, 어디에서 있었던 일인지 알려주세요.'),
    '신고 내용',
  );
  await fireEvent.press(ui.getByText('신고 접수하기'));
  assert.equal(submit.mock.calls[0][0].submittedText.length, 5000);
  await ui.rerender(
    <ReportSheet visible target={{ ...target, targetId: '다른-편지' }} onClose={jest.fn()} />,
  );
  await act(async () => resolve({ reportId: '이전-접수', receivedAt: '2026-11-12T00:00:00Z' }));
  assert.equal(ui.queryByText('신고를 접수했어요'), null);
  assert.ok(ui.getByText('신고 접수하기'));
});
