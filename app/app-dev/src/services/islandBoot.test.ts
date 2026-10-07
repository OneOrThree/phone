/**
 * GROMO-2006 부팅 경로 결정 회귀 — decideBootRoute의 세대 fence를 고정한다.
 * 핵심: checkSession이 active를 돌려준 뒤 syncIslands가 401로 실패하면 세션 상실 핸들러가
 * 이미 login으로 돌렸다 — stale account로 chooseIsland를 쓰면 안 된다.
 */
import assert from 'node:assert/strict';
import { decideBootRoute } from '@/services/islandBoot';
import { ApiError } from '@/services/api/client';
import type { MyIslands } from '@/services/api/islands';

const myIslands = (over: Partial<MyIslands> = {}): MyIslands => ({
  items: [],
  nextCursor: null,
  currentIslandId: null,
  lossReason: null,
  ...over,
});
const account = { onboardingComplete: true };

const deps = (over: Record<string, unknown> = {}) => {
  let gen = 0;
  const bootErrors: boolean[] = [];
  return {
    gen: () => gen,
    setGen: (g: number) => {
      gen = g;
    },
    bootErrors,
    args: {
      saved: null,
      account,
      rejected: false,
      serverMode: true,
      bootGen: 0,
      generation: () => gen,
      syncIslands: async () => myIslands(),
      onBootError: (on: boolean) => bootErrors.push(on),
      ...over,
    },
  };
};

test('checkSession active 뒤 syncIslands의 401 → 세대가 죽어 null — login 핸들러가 이긴다', async () => {
  const d = deps({
    // 401: client가 세션을 지우고 notifySessionLost → 세대가 올라간 채 오류를 던진다
    syncIslands: async () => {
      d.setGen(1);
      throw new ApiError('UNAUTHORIZED', 'unauthorized', 401);
    },
  });
  const route = await decideBootRoute(d.args as never);
  assert.equal(route, null); // stale account로 chooseIsland를 쓰지 않는다
  assert.equal(d.bootErrors.length, 0); // 죽은 세대의 오류 플래그도 쓰지 않는다
});

test('myJoinRequests 401도 같은 경로 — 세대가 죽으면 route를 돌려주지 않는다', async () => {
  const d = deps({
    syncIslands: async () => {
      d.setGen(1);
      throw new ApiError('UNAUTHORIZED', 'unauthorized', 401);
    },
    saved: { loggedIn: true, onboarded: true },
  });
  assert.equal(await decideBootRoute(d.args as never), null);
});

test('정상 동기화 — serverMode에서 current가 있으면 home 으로 부팅한다(로컬 집중 세션은 복구하지 않는다)', async () => {
  const d = deps({
    syncIslands: async () => myIslands({ currentIslandId: 'i1' }),
    saved: { loggedIn: true, onboarded: true, session: { status: 'active' } },
  });
  const route = await decideBootRoute(d.args as never);
  assert.equal(route, 'home'); // focus·rest 로컬 복구 금지 — 서버 recover 가 따로 한다
  assert.deepEqual(d.bootErrors, [false]);
});

test('성공 응답도 죽은 세대에 도착하면 버린다 — 플래그 해제·route 쓰기 없음', async () => {
  const d = deps({
    syncIslands: async () => {
      d.setGen(1); // 응답 도착 직전에 세션이 죽었다
      return myIslands({ currentIslandId: 'i1' });
    },
  });
  assert.equal(await decideBootRoute(d.args as never), null);
  assert.equal(d.bootErrors.length, 0); // onBootError(false)도 쓰지 않는다
});

test('동기화 실패(세대 생존)는 오류 플래그를 세우고 무소속으로 chooseIsland를 돌려준다', async () => {
  const d = deps({
    syncIslands: async () => {
      throw new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0);
    },
    saved: { loggedIn: true, onboarded: true },
  });
  const route = await decideBootRoute(d.args as never);
  assert.equal(route, 'chooseIsland'); // 로컬 onboarded로 home에 들어가지 않는다
  assert.deepEqual(d.bootErrors, [true]);
});

test('저장본도 계정도 없으면 null — 호출부가 setRoute를 하지 않는다', async () => {
  const d = deps({ account: null, serverMode: false, saved: null });
  assert.equal(await decideBootRoute(d.args as never), null);
});
