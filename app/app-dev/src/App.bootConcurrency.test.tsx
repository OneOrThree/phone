/**
 * GROMO-2377 — 부팅의 서버 조회는 데이터 의존이 없는 것끼리 함께 나간다.
 * ① /me 는 부팅에서 한 번만 — checkSession 이 읽은 계정을 섬 동기화가 다시 쓴다.
 * ② 섬 동기화·집중 복구·홈 스냅샷은 어느 응답도 오기 전에 모두 요청된다.
 * ③ 반영 순서는 그대로다 — 복구가 먼저 답해도 SESSION_SYNC 는 ISLAND_SYNC 뒤에 적용된다.
 * 실제 checkSession·decideBootRoute·섬/집중 명령·홈 로더를 돌리고 네트워크(request)만 가로챈다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { rememberLocalDataOwner, saveSession } from '@/services/api/session';

let captured: any;
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/liveActivityPush', () => ({
  startLiveActivityPushSync: () => () => {},
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 요청마다 손으로 답하는 지연 응답. 답하지 않은 요청(부팅과 무관한 화면 조회)은 끝까지 걸려 있다.
const mockCalls: { path: string; resolve: (value: unknown) => void }[] = [];
jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: (path: string) =>
    new Promise((resolve) => mockCalls.push({ path: path.split('?')[0], resolve })),
}));
const requested = (path: string) => mockCalls.filter((call) => call.path === path);
const answer = (path: string, value: unknown) => requested(path)[0].resolve(value);

const BOOT_READS = [
  '/me/islands',
  '/me/join-requests',
  '/focus-sessions/current',
  '/focus-sessions/pending-result',
  '/screens/home',
];

test('부팅 — /me 는 한 번, 섬 동기화·집중 복구·홈 스냅샷은 함께 나가고 반영은 원래 순서다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  await rememberLocalDataOwner('u1');
  const app = await render(<App />);

  await waitFor(() => assert.equal(requested('/me').length, 1));
  await act(async () =>
    answer('/me', {
      id: 'u1',
      name: '부팅',
      catColor: null,
      mainIslandId: 'i1',
      linkedProviders: [],
      onboardingComplete: true,
    }),
  );
  // 직렬이면 섬 동기화 응답 전에는 복구·홈 요청이 없다
  await waitFor(() => {
    for (const path of BOOT_READS) assert.equal(requested(path).length, 1, path);
  });
  assert.ok(!captured); // 아직 로딩 화면이다

  // 복구·홈이 먼저 답한다. 세션은 소속 밖 섬의 것(순서 탐침) — SESSION_SYNC 가 먼저 적용되면 뒤의
  // ISLAND_SYNC 가 «소속 밖 섬 세션»으로 지운다.
  const now = new Date().toISOString();
  await act(async () => {
    answer('/focus-sessions/current', {
      id: 's1',
      islandId: 'i-other',
      subject: '수학',
      status: 'active',
      activeSeconds: 60,
      serverNow: now,
      startedAt: now,
      restStartedAt: null,
      version: 1,
    });
    answer('/focus-sessions/pending-result', null);
    answer('/screens/home', {
      island: { id: 'i1', name: '섬', role: 'host', memberCount: 1, maxMembers: 15 },
      focusSummary: { totalSeconds: 0 },
      session: null,
      restMembers: { items: [], serverNow: now, watermarks: [] },
      wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 0 },
      playback: null,
      playbackAvailability: 'available',
      buildings: [],
      members: { items: [], nextCursor: null },
    });
  });
  assert.ok(!captured); // 섬 동기화 전에는 부팅을 끝내지 않는다
  await act(async () => {
    answer('/me/islands', {
      items: [{ id: 'i1', name: '섬', role: 'host', memberCount: 1, maxMembers: 15 }],
      nextCursor: null,
      currentIslandId: 'i1',
      lossReason: null,
    });
    answer('/me/join-requests', { items: [], nextCursor: null });
  });

  await waitFor(() => assert.ok(captured));
  assert.equal(captured.state.session?.id, 's1');
  assert.equal(captured.state.mainIslandId, 'i1'); // 동기화가 checkSession 의 계정을 썼다
  // 첫 /screens/home 요청에만 답했다 — 홈 effect 가 부팅이 미리 받은 응답을 그대로 썼다
  await waitFor(() => assert.equal(captured.state.serverIslands?.home?.islandId, 'i1'));
  assert.equal(requested('/me').length, 1);
  await app.unmount();
});
