import { Platform } from 'react-native';
import { ApiError, request } from './api/client';
import { getTelescope } from './api/telescope';
import { currentFocusSession } from './api/focusSessions';
import { decideBootRoute } from './islandBoot';
import {
  enterSharedWebIsland,
  enterWebIslandAtBoot,
  sharedWebIslandId,
  usesSharedWebIsland,
} from './webIsland';

let mockGeneration = 1;
jest.mock('./api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('./api/client', () => {
  const real = jest.requireActual('./api/client');
  return { ...real, request: jest.fn(), uuid: () => `key-${mockGeneration}` };
});
jest.mock('./api/focusSessions', () => ({ currentFocusSession: jest.fn() }));
const requestMock = jest.mocked(request);
const originalPlatform = Platform.OS;
const originalPublic = process.env.EXPO_PUBLIC_WEB_DEMO;
const originalShared = process.env.EXPO_PUBLIC_WEB_SHARED_ISLAND;
const island = {
  id: 'shared',
  role: 'member',
  membershipStatus: 'active',
  currentIslandId: 'shared',
};
const my = { items: [], currentIslandId: 'shared', nextCursor: null, lossReason: null };
beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration++;
  Platform.OS = 'web';
  process.env.EXPO_PUBLIC_WEB_DEMO = '1';
  process.env.EXPO_PUBLIC_WEB_SHARED_ISLAND = '1';
  requestMock.mockResolvedValue(island);
});
afterEach(() => {
  Platform.OS = originalPlatform;
  for (const [key, value] of Object.entries({
    EXPO_PUBLIC_WEB_DEMO: originalPublic,
    EXPO_PUBLIC_WEB_SHARED_ISLAND: originalShared,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('서버에 목적지를 맡기고 중복 입장 요청을 하나로 합친다', async () => {
  await Promise.all([enterSharedWebIsland(), enterSharedWebIsland()]);
  expect(requestMock).toHaveBeenCalledTimes(1);
  expect(requestMock).toHaveBeenCalledWith('/me/web-island', {
    method: 'POST',
    idempotencyKey: `key-${mockGeneration}`,
  });
  expect(sharedWebIslandId()).toBe('shared');
});

test('응답 유실 뒤 같은 멱등 키로 재시도한다', async () => {
  requestMock.mockRejectedValueOnce(new Error('network'));
  await expect(enterSharedWebIsland()).rejects.toThrow('network');
  await enterSharedWebIsland();
  expect(requestMock.mock.calls[0][1]?.idempotencyKey).toBe(
    requestMock.mock.calls[1][1]?.idempotencyKey,
  );
});

test('로그아웃 뒤 늦게 도착한 배정은 새 세션에 반영하지 않는다', async () => {
  let finish!: (value: unknown) => void;
  requestMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = enterSharedWebIsland();
  mockGeneration++;
  finish(island);
  await expect(pending).rejects.toMatchObject({ code: 'CLIENT_STALE_SESSION' });
  expect(sharedWebIslandId()).toBeUndefined();
});

test('기존 집중이 있을 때만 섬 이동을 미룬다', async () => {
  requestMock.mockRejectedValue(new ApiError('STATE_CONFLICT', '', 409));
  jest.mocked(currentFocusSession).mockResolvedValueOnce({ id: 'live' } as never);
  await expect(enterWebIslandAtBoot()).resolves.toBeUndefined();
  jest.mocked(currentFocusSession).mockResolvedValueOnce(null);
  await expect(enterWebIslandAtBoot()).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
});

const boot = () => ({
  saved: null,
  account: { onboardingComplete: true },
  rejected: false,
  serverMode: true,
  bootGen: mockGeneration,
  generation: () => mockGeneration,
  syncIslands: jest.fn().mockResolvedValue(my),
  onBootError: jest.fn(),
});
test('프로필 완료 계정은 웹 섬 배정 후 서버 소속을 동기화한다', async () => {
  const deps = boot();
  await expect(decideBootRoute(deps)).resolves.toBe('home');
  expect(requestMock).toHaveBeenCalledTimes(1);
  expect(deps.syncIslands).toHaveBeenCalledTimes(1);
});
test('입장 실패는 다른 섬 탐색 대신 재시도 화면을 연다', async () => {
  requestMock.mockRejectedValueOnce(new Error('offline'));
  await expect(decideBootRoute(boot())).resolves.toBe('webIsland');
});
test('프로필 미완료는 기존 고양이·이름 온보딩부터 시작한다', async () => {
  const deps = boot();
  deps.account.onboardingComplete = false;
  await expect(decideBootRoute(deps)).resolves.toBe('character');
  expect(requestMock).not.toHaveBeenCalled();
});
test.each(['ios', 'android'] as const)(
  '네이티브 %s에는 웹 배정이 적용되지 않는다',
  async (platform) => {
    Platform.OS = platform;
    expect(usesSharedWebIsland()).toBe(false);
    await expect(decideBootRoute(boot())).resolves.toBe('home');
    expect(requestMock).not.toHaveBeenCalled();
  },
);
test('서버 배포 전 플래그가 꺼진 웹은 기존 경로를 유지한다', async () => {
  process.env.EXPO_PUBLIC_WEB_SHARED_ISLAND = '0';
  await decideBootRoute(boot());
  expect(requestMock).not.toHaveBeenCalled();
});

test('웹 섬 입장 뒤 옛 로컬 바다 경로로 돌아가지 않는다', async () => {
  await expect(
    decideBootRoute({ ...boot(), saved: { loggedIn: true, session: { kind: 'sea' } } }),
  ).resolves.toBe('home');
});

test('공개 웹 망원경은 배정된 섬만 보여 준다', async () => {
  await enterSharedWebIsland();
  const item = (islandId: string) => ({
    islandId,
    name: islandId,
    memberCount: 16,
    maxMembers: 15,
    sailingMinutes: 15,
  });
  requestMock.mockResolvedValueOnce({
    bucketStart: '',
    nextRefreshMinutes: 30,
    items: [item('other'), item('shared')],
  });
  expect((await getTelescope()).items.map((i) => i.islandId)).toEqual(['shared']);
});
