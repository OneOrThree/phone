import { createPreviewEnvironment } from '@/navigation/previewEnvironment';
import { enterSharedWebIsland } from '@/services/webIsland';
import { act, fireEvent, render } from '@testing-library/react-native';
import { WebIslandEntry } from './WebIslandEntry';

let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('@/services/webIsland', () => ({ enterSharedWebIsland: jest.fn() }));
const enter = jest.mocked(enterSharedWebIsland);
const sync = jest.fn();
const reset = jest.fn();
const dispatch = jest.fn();
const environment = () => createPreviewEnvironment({ islands: { sync }, reset, dispatch });
beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration++;
  enter.mockResolvedValue({
    id: 'web',
    currentIslandId: 'web',
    role: 'member',
    membershipStatus: 'active',
  });
  sync.mockResolvedValue({ currentIslandId: 'web', items: [], nextCursor: null, lossReason: null });
});

test('배정과 서버 소속 동기화가 모두 끝난 뒤 온보딩을 완료하고 홈으로 간다', async () => {
  await render(<WebIslandEntry e={environment()} />);
  expect(enter).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith({ type: 'ONBOARDING_STORY', checkpoint: 'done' });
  expect(reset).toHaveBeenCalledWith('home');
});

test('입장 실패는 완료 처리하지 않고 재시도할 수 있다', async () => {
  enter.mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<WebIslandEntry e={environment()} />);
  expect(reset).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('다시 들어가기'));
  expect(enter).toHaveBeenCalledTimes(2);
  expect(reset).toHaveBeenCalledWith('home');
});

test('동기화 실패도 성공 화면으로 보내지 않는다', async () => {
  sync.mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<WebIslandEntry e={environment()} />);
  expect(dispatch).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  expect(screen.getByText('다시 들어가기')).toBeTruthy();
});

test('입장 요청 중 로그아웃하면 늦은 성공으로 홈을 열지 않는다', async () => {
  let finish!: (value: never) => void;
  enter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<WebIslandEntry e={environment()} />);
  mockGeneration++;
  await act(async () => {
    finish({ id: 'web' } as never);
  });
  expect(sync).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

test('다른 기기에서 현재 섬이 바뀌었으면 입장 재시도를 남긴다', async () => {
  sync.mockResolvedValueOnce({
    currentIslandId: 'other',
    items: [],
    nextCursor: null,
    lossReason: null,
  });
  const screen = await render(<WebIslandEntry e={environment()} />);
  expect(reset).not.toHaveBeenCalled();
  expect(screen.getByText('다시 들어가기')).toBeTruthy();
});
