import { act, renderHook } from '@testing-library/react-native';
import { Share } from 'react-native';
import { issueInvitation } from '@/services/api/islands';
import { sessionGeneration } from '@/services/api/session';
import { isMockMode } from '@/services/demoMode';
import { useInviteShare } from './useInviteShare';
import { ApiError } from '@/services/api/client';

jest.mock('@/services/api/islands', () => ({ issueInvitation: jest.fn() }));
jest.mock('@/services/api/session', () => ({ sessionGeneration: jest.fn(() => 1) }));
jest.mock('@/services/demoMode', () => ({ isMockMode: jest.fn(() => false) }));

const issued = { code: 'ABC123', url: 'https://link.example/l/ABC123?g=island', expiresAt: null };
const issue = jest.mocked(issueInvitation);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sessionGeneration).mockReturnValue(1);
  jest.mocked(isMockMode).mockReturnValue(false);
  issue.mockResolvedValue(issued);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

test('서버가 발급한 URL을 공유 본문에 그대로 담는다', async () => {
  const { result } = await renderHook(() => useInviteShare('island', '구름섬', jest.fn()));
  await act(() => result.current.share());
  expect(issue).toHaveBeenCalledWith('island', expect.any(String));
  expect(Share.share).toHaveBeenCalledWith({
    message: `구름섬에서 같이 집중해요!\n${issued.url}`,
  });
});

test('발급 실패 시 코드를 공유하지 않고 같은 멱등 키로 재시도한다', async () => {
  const notify = jest.fn();
  issue.mockRejectedValueOnce(new Error('응답 유실'));
  const { result } = await renderHook(() => useInviteShare('island', '구름섬', notify));
  await act(() => result.current.share());
  expect(Share.share).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalled();
  await act(() => result.current.share());
  expect(issue.mock.calls[0][1]).toBe(issue.mock.calls[1][1]);
  expect(Share.share).toHaveBeenCalledTimes(1);
});

test('연속 탭은 하나만 발급하며 세션이 바뀐 뒤 도착한 링크는 공유하지 않는다', async () => {
  let finish!: (value: typeof issued) => void;
  issue.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const { result } = await renderHook(() => useInviteShare('island', '구름섬', jest.fn()));
  let pending!: Promise<void>;
  await act(() => {
    pending = result.current.share();
    void result.current.share();
  });
  expect(result.current.busy).toBe(true);
  expect(issue).toHaveBeenCalledTimes(1);
  jest.mocked(sessionGeneration).mockReturnValue(2);
  await act(async () => {
    finish(issued);
    await pending;
  });
  expect(Share.share).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
});

test('시연 모드에서는 가짜 초대 링크를 만들거나 서버를 호출하지 않는다', async () => {
  jest.mocked(isMockMode).mockReturnValue(true);
  const notify = jest.fn();
  const { result } = await renderHook(() => useInviteShare('island', '구름섬', notify));
  await act(() => result.current.share());
  expect(issue).not.toHaveBeenCalled();
  expect(Share.share).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalled();
});

test('섬 ID가 없으면 발급 API를 호출하지 않는다', async () => {
  const notify = jest.fn();
  const { result } = await renderHook(() => useInviteShare('', '구름섬', notify));
  await act(() => result.current.share());
  expect(issue).not.toHaveBeenCalled();
  expect(Share.share).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('섬 정보를 불러온 뒤 다시 시도해 주세요.');
});

test('확정된 발급 거절 뒤의 재시도는 새 멱등 키를 사용한다', async () => {
  issue.mockRejectedValueOnce(new ApiError('MEMBER_ONLY', '주민만 가능해요.', 403));
  const { result } = await renderHook(() => useInviteShare('island', '구름섬', jest.fn()));
  await act(() => result.current.share());
  await act(() => result.current.share());
  expect(issue.mock.calls[0][1]).not.toBe(issue.mock.calls[1][1]);
});
