import { getFocusTags, setupFocusTag } from '@/services/focusApi';
import { beginTagEditTransition, syncTagCreated } from './tagSync';

jest.mock('@/services/focusApi', () => ({
  getFocusTags: jest.fn(),
  setupFocusTag: jest.fn(),
  updateFocusTag: jest.fn(),
  deleteFocusTag: jest.fn(),
}));

const mockGetFocusTags = getFocusTags as jest.MockedFunction<typeof getFocusTags>;
const mockSetupFocusTag = setupFocusTag as jest.MockedFunction<typeof setupFocusTag>;

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFocusTags.mockResolvedValue([]);
  mockSetupFocusTag.mockResolvedValue(undefined);
});

test('새 토큰 노출 전 실행 중인 태그 편집을 drain하고 이후 편집은 commit 시 폐기한다', async () => {
  let finishRunningEdit!: () => void;
  mockSetupFocusTag.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRunningEdit = resolve;
      }),
  );

  syncTagCreated('이전 계정 실행 중');
  await flushPromises();

  let transitionReady = false;
  const transitionPromise = beginTagEditTransition().then((transition) => {
    transitionReady = true;
    return transition;
  });
  syncTagCreated('전환 중 대기');
  await flushPromises();

  expect(transitionReady).toBe(false);
  expect(mockSetupFocusTag).toHaveBeenCalledTimes(1);

  finishRunningEdit();
  const transition = await transitionPromise;
  transition.commit();
  await flushPromises();

  expect(mockSetupFocusTag).toHaveBeenCalledTimes(1);
});

test('세션 저장 rollback이면 전환 중 들어온 이전 계정 편집을 재개한다', async () => {
  const transition = await beginTagEditTransition();
  syncTagCreated('롤백 후 재개');
  await flushPromises();

  expect(mockSetupFocusTag).not.toHaveBeenCalled();

  transition.rollback();
  await flushPromises();

  expect(mockSetupFocusTag).toHaveBeenCalledWith({ name: '롤백 후 재개' });
});
