/**
 * useTelescope (GROMO-2266·2269) — 열려 있는 망원경 목록은 섬 넣기가 서버에 반영되면 다시 읽는다.
 * 넣기 요청이 느려 끝나기 전에 망원경을 열어 옛 목록을 받아 둔 경우를 메운다.
 * getTelescope 와 요청(request)만 목이고 pinToTelescope·구독(onTelescopeChanged)은 실제 구현이다.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useTelescope } from '@/screens/island/useTelescope';
import { ApiError, request } from '@/services/api/client';
import { getTelescope, pinToTelescope, type Telescope } from '@/services/api/telescope';

jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: jest.fn(),
}));
// 구독자가 불린 횟수를 센다 — 언마운트된 훅의 setState 는 React 가 조용히 무시해 읽기 횟수로는 구독이 풀렸는지 보이지 않는다.
const mockFired = jest.fn();
jest.mock('@/services/api/telescope', () => {
  const actual = jest.requireActual('@/services/api/telescope');
  return {
    ...actual,
    getTelescope: jest.fn(),
    onTelescopeChanged: (listener: () => void) =>
      actual.onTelescopeChanged(() => {
        mockFired();
        listener();
      }),
  };
});

const getMock = getTelescope as jest.Mock;
const requestMock = request as jest.Mock;

beforeEach(() => {
  getMock.mockReset();
  requestMock.mockReset();
  mockFired.mockClear();
});

const wire = (...ids: string[]): Telescope => ({
  bucketStart: '2026-10-12T05:00:00Z',
  nextRefreshMinutes: 30,
  items: ids.map((id) => ({
    islandId: id,
    name: `섬 ${id}`,
    intro: '',
    memberCount: 1,
    maxMembers: 15,
    approvalRequired: false,
    membershipStatus: 'none',
    slot: 'random',
    sailingMinutes: 30,
    averageFocusMinutesPerDay: null,
    full: false,
    arrivedBefore: false,
  })),
});
const pinned = (id: string) => ({ item: { islandId: id, slot: 'pinned' }, evicted: null });
const ids = (hook: { result: { current: { items: { islandId: string }[] } } }) =>
  hook.result.current.items.map((item) => item.islandId);
const mount = async (active = true) => {
  const hook = await renderHook(() => useTelescope({ active }));
  if (active) await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
};

test('마운트된 채로 넣기가 성공하면 목록을 다시 읽어 새 핀이 보인다(느린 넣기보다 먼저 받은 옛 목록)', async () => {
  getMock.mockResolvedValueOnce(wire('a', 'b')).mockResolvedValueOnce(wire('a', 'p'));
  requestMock.mockResolvedValue(pinned('p'));
  const hook = await mount();
  expect(ids(hook)).toEqual(['a', 'b']);
  expect(getMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    await pinToTelescope('p', 'observatory');
  });

  await waitFor(() => expect(ids(hook)).toEqual(['a', 'p']));
  expect(getMock).toHaveBeenCalledTimes(2);
});

test('첫 읽기가 끝나기 전에 넣기가 끝나면 옛 응답은 버리고 다시 읽은 목록을 보인다', async () => {
  let resolveOld!: (value: Telescope) => void;
  getMock
    .mockReturnValueOnce(new Promise<Telescope>((resolve) => (resolveOld = resolve)))
    .mockResolvedValueOnce(wire('a', 'p'));
  requestMock.mockResolvedValue(pinned('p'));
  const hook = await renderHook(() => useTelescope({ active: true }));

  await act(async () => {
    await pinToTelescope('p', 'observatory');
  });
  await waitFor(() => expect(ids(hook)).toEqual(['a', 'p']));
  expect(getMock).toHaveBeenCalledTimes(2);

  // 뒤늦게 도착한 옛 목록이 새 목록을 덮어쓰지 않는다
  await act(async () => resolveOld(wire('a')));
  expect(ids(hook)).toEqual(['a', 'p']);
});

test('넣기가 실패하면 목록을 다시 읽지 않는다', async () => {
  getMock.mockResolvedValue(wire('a'));
  requestMock.mockRejectedValue(new ApiError('STATE_CONFLICT', '내 소속 섬이에요', 409));
  const hook = await mount();

  await act(async () => {
    await expect(pinToTelescope('mine', 'observatory')).rejects.toBeInstanceOf(ApiError);
  });

  expect(getMock).toHaveBeenCalledTimes(1);
  expect(mockFired).not.toHaveBeenCalled();
  expect(ids(hook)).toEqual(['a']);
});

test('언마운트하면 구독이 풀려 그 뒤의 넣기에는 불리지 않는다', async () => {
  getMock.mockResolvedValue(wire('a'));
  requestMock.mockResolvedValue(pinned('p'));
  const hook = await mount();
  await act(async () => {
    await pinToTelescope('p', 'observatory');
  });
  expect(mockFired).toHaveBeenCalledTimes(1);

  await hook.unmount();
  await pinToTelescope('p', 'observatory'); // 화면을 떠난 뒤 끝난 넣기 — 구독자가 없어 아무 일도 없다

  expect(mockFired).toHaveBeenCalledTimes(1);
  expect(getMock).toHaveBeenCalledTimes(2);
});

test('비활성(목업·서버 세션 없음)이면 구독도 읽기도 없다', async () => {
  requestMock.mockResolvedValue(pinned('p'));
  await mount(false);

  await act(async () => {
    await pinToTelescope('p', 'observatory');
  });

  expect(mockFired).not.toHaveBeenCalled();
  expect(getMock).not.toHaveBeenCalled();
});
