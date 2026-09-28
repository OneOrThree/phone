import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  clearSession,
  getLastSessionUserId,
  getSession,
  rememberLocalDataOwner,
  restoreSession,
  saveSession,
  sessionGeneration,
  subscribeSession,
} from '@/services/api/session';

const write = SecureStore.setItemAsync as jest.Mock;
const remove = SecureStore.deleteItemAsync as jest.Mock;
// jest.setup.js 의 메모리 저장소 구현. 찢어진 쓰기·삭제를 흉내 낸 뒤 여기로 되돌린다.
const realWrite = write.getMockImplementation() as (key: string, value: string) => Promise<void>;
const realRemove = remove.getMockImplementation() as (key: string) => Promise<void>;

beforeEach(async () => {
  write.mockImplementation(realWrite);
  remove.mockImplementation(realRemove);
  write.mockClear();
  await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
  await SecureStore.deleteItemAsync('gromo.legacySessionMigrated');
  await SecureStore.deleteItemAsync('gromo.legacySessionPendingPromotion');
  await clearSession();
});

test('Android 1.x의 완전한 JWT 세션은 SecureStore로 복사하고 원본 키와 pending 표시를 보존한다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
    ['gromo:user', JSON.stringify({ accessToken })],
  ]);
  write.mockClear();

  try {
    assert.deepEqual(await restoreSession(), {
      accessToken,
      refreshToken: 'legacy-refresh',
      userId: 'legacy-user',
    });
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), accessToken);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionPendingPromotion'), '1');
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionMigrated'), null);
    const writeKeys = write.mock.calls.map(([key]) => key);
    assert.equal(writeKeys[0], 'gromo.legacySessionPendingPromotion');
    assert.ok(writeKeys.indexOf('gromo.sessionBundle') > 0);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android의 부분 레거시 세션은 가져오지 않고 원본 자격 키를 보존한다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await AsyncStorage.setItem('gromo:accessToken', 'legacy-access-only');

  try {
    assert.equal(await restoreSession(), null);
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), 'legacy-access-only');
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionMigrated'), null);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android 레거시 세션 커밋이 실패하면 원본을 보존해 다음 부팅에서 재시도한다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);
  write.mockImplementation(async () => {
    throw new Error('키체인 쓰기 실패');
  });

  try {
    assert.equal(await restoreSession(), null);
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), accessToken);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionMigrated'), null);
  } finally {
    write.mockImplementation(realWrite);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android pending 보호 표식 쓰기가 실패하면 SecureStore 세션 커밋을 시작하지 않는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.legacySessionPendingPromotion') throw new Error('보호 표식 쓰기 실패');
    await realWrite(key, value);
  });

  try {
    assert.equal(await restoreSession(), null);
    assert.equal(write.mock.calls.length, 1);
    assert.equal(write.mock.calls[0][0], 'gromo.legacySessionPendingPromotion');
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), accessToken);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
  } finally {
    write.mockImplementation(realWrite);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('저장한 세션은 그대로 복구된다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  assert.deepEqual(await restoreSession(), { accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('로그아웃은 토큰만 지우고 마지막 사용자 ID를 재로그인 소유권 판정용으로 보존한다', async () => {
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await restoreSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'same-user' });
  await rememberLocalDataOwner('same-user');

  await clearSession();
  assert.equal(getSession(), null);
  assert.equal(getLastSessionUserId(), 'same-user');

  // 재시작 시나리오: restoreSession이 저장된 메타데이터만으로 ID를 복구한다.
  await restoreSession();
  assert.equal(getSession(), null);
  assert.equal(getLastSessionUserId(), 'same-user');
});

test('로그인 저장만 성공하고 채택이 실패하면 이전 로컬 소유자를 재시도까지 보존한다', async () => {
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await restoreSession();
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'old-user' });
  await rememberLocalDataOwner('old-user');
  await clearSession();

  const firstAdoptionOwner = getLastSessionUserId();
  await saveSession({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', userId: 'new-user' });
  // /me 또는 후속 채택 단계 실패: 성공 완료 기록이 없어 소유자는 아직 이전 계정이어야 한다.
  assert.equal(getLastSessionUserId(), 'old-user');
  await restoreSession();
  const retryAdoptionOwner = getLastSessionUserId();
  assert.equal(firstAdoptionOwner, 'old-user');
  assert.equal(retryAdoptionOwner, 'old-user');

  await rememberLocalDataOwner('new-user');
  assert.equal(getLastSessionUserId(), 'new-user');
});

test('stale 계정 채택은 현재 세션이 바뀌었으면 로컬 소유자를 덮지 않는다', async () => {
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await restoreSession();
  await saveSession({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', userId: 'new-user' });
  assert.equal(await rememberLocalDataOwner('new-user'), true);

  await saveSession({ accessToken: 'OTHER_AT', refreshToken: 'OTHER_RT', userId: 'other-user' });
  assert.equal(await rememberLocalDataOwner('new-user'), false);
  assert.equal(getLastSessionUserId(), 'new-user');
});

test('로컬 소유자 durable 기록 실패는 기존 owner를 유지하고 채택 호출을 reject한다', async () => {
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await restoreSession();
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'old-user' });
  await rememberLocalDataOwner('old-user');
  await saveSession({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', userId: 'new-user' });
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.lastUserId') throw new Error('owner 저장 실패');
    await realWrite(key, value);
  });

  try {
    await assert.rejects(rememberLocalDataOwner('new-user'), /owner 저장 실패/);
    assert.equal(getLastSessionUserId(), 'old-user');
    assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'old-user');
  } finally {
    write.mockImplementation(realWrite);
  }
});

test('세션 구독은 현재 snapshot과 로그인·로그아웃·세대 교체 뒤 공개된 값만 전달한다', async () => {
  const seen: string[] = [];
  const unsubscribe = subscribeSession((session) => seen.push(session?.userId ?? 'none'));
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  await clearSession();
  unsubscribe();
  await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  assert.deepEqual(seen, ['none', 'u1', 'none']);
});

test('던지는 구독자는 clearSession의 durable 삭제나 다른 구독자를 막지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  const seen: string[] = [];
  const stopBroken = subscribeSession(() => {
    throw new Error('render failed');
  });
  const stopHealthy = subscribeSession((session) => seen.push(session?.userId ?? 'none'));
  remove.mockClear();
  await clearSession();
  assert.equal(getSession(), null);
  assert.deepEqual(seen, ['u1', 'none']);
  assert.deepEqual(
    new Set(remove.mock.calls.map((call) => call[0])),
    new Set(['gromo.sessionBundle', 'gromo.accessToken', 'gromo.refreshToken', 'gromo.userId']),
  );
  stopBroken();
  stopHealthy();
});

test('커밋 마커를 마지막에 쓴다 — 중간에 죽으면 복구를 거부한다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  const keys = write.mock.calls.map((c) => c[0]).filter((key) => key !== 'gromo.lastUserId');
  assert.equal(keys[keys.length - 1], 'gromo.sessionBundle');
});

test('AT 만 쓰이고 RT 쓰기 전에 죽으면 혼합 세션으로 복구되지 않는다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });

  // 두 번째 커밋: AT 만 새로 쓰이고 RT·userId·마커는 옛 값으로 남은 상태를 재현한다.
  write.mockImplementation(async (key: string, value: string) => {
    if (key !== 'gromo.accessToken') throw new Error('프로세스 종료');
    return realWrite(key, value);
  });
  await assert.rejects(saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u1' }));

  // 셋 다 값이 있어도(AT2 + RT1 + u1) 태그가 어긋나므로 세션이 아니다.
  assert.equal(await restoreSession(), null);
});

test('커밋이 끝난 뒤에야 새 세션을 공개한다 — 부분 실패면 이전 세션 그대로다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  const before = sessionGeneration();

  // RT 쓰기만 «한 번» 실패한다(되돌리기는 성공하는 상황).
  let failOnce = true;
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.refreshToken' && failOnce) {
      failOnce = false;
      throw new Error('키체인 쓰기 실패');
    }
    return realWrite(key, value);
  });
  await assert.rejects(saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' }));

  // 화면은 「전환 실패」인데 요청만 새 계정 토큰으로 나가는 상태를 만들지 않는다.
  assert.deepEqual(getSession(), { accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  assert.equal(sessionGeneration(), before);
  // 재시작해도 이전 세션이 그대로 살아난다.
  assert.deepEqual(await restoreSession(), {
    accessToken: 'AT1',
    refreshToken: 'RT1',
    userId: 'u1',
  });
});

test('clearSession 은 마커 삭제가 실패해도 나머지 값을 마저 지운다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  remove.mockImplementation(async (key: string) => {
    if (key === 'gromo.sessionBundle') throw new Error('키체인 삭제 실패');
    return realRemove(key);
  });

  await assert.rejects(clearSession());

  // 마커는 남았지만 값이 사라져 다음 실행에서 세션으로 되살아나지 않는다.
  remove.mockImplementation(realRemove);
  assert.equal(getSession(), null);
  assert.equal(await restoreSession(), null);
});

test('clearSession 은 마커를 먼저 지운다 — 뒤가 실패해도 세션이 되살아나지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  remove.mockClear();

  await clearSession();

  assert.equal(remove.mock.calls[0][0], 'gromo.sessionBundle');
  assert.equal(getSession(), null);
  assert.equal(await restoreSession(), null);
});

test('쓰기 하나가 먼저 실패해도 남은 쓰기가 «정착한 뒤에» 되돌린다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });

  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 첫 커밋에서만: AT 쓰기는 즉시 실패하고 RT 쓰기는 «늦게» 성공한다(되돌리기는 정상 동작).
  let first = true;
  write.mockImplementation(async (key: string, value: string) => {
    if (!first) return realWrite(key, value);
    if (key === 'gromo.accessToken') throw new Error('키체인 쓰기 실패');
    if (key === 'gromo.refreshToken') {
      first = false;
      await slow;
    }
    return realWrite(key, value);
  });

  const saving = saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  // 되돌리기가 이 쓰기를 기다리지 않으면, 늦은 RT2 가 되돌린 마커 «뒤에» 착지한다.
  setTimeout(release, 0);
  await assert.rejects(saving);
  // 그 늦은 쓰기가 착지할 틈을 준다 — 안 주면 되돌리기와의 순서가 드러나지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // 저장 실패 한 번이 「멀쩡하던 이전 세션까지 복구 거부」= 불필요한 로그아웃으로 번지면 안 된다.
  assert.deepEqual(getSession(), { accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  assert.deepEqual(await restoreSession(), {
    accessToken: 'AT1',
    refreshToken: 'RT1',
    userId: 'u1',
  });
});

test('늦게 도착한 저장은 그 사이 끝난 로그아웃을 되살리지 않는다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  // 로그인 요청이 시작될 때 잡아 둔 세대.
  const generation = sessionGeneration();

  // 응답과 저장 사이에 로그아웃이 끝났다.
  await clearSession();

  assert.equal(
    await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u1' }, generation),
    false,
  );
  assert.equal(getSession(), null);
  assert.equal(await restoreSession(), null);
});

test('저장 «도중» 들어온 삭제는 줄 뒤에 선다 — 쓰기와 삭제가 섞이지 않는다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });

  let clearing: Promise<unknown> | null = null;
  write.mockImplementation(async (key: string, value: string) => {
    // 커밋이 첫 키를 쓰는 사이에 로그아웃이 들어온다.
    clearing ??= clearSession();
    return realWrite(key, value);
  });

  await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u2' });
  await clearing;

  // 삭제가 저장 «뒤에» 통째로 실행되므로 마지막 상태는 로그아웃이다.
  assert.equal(getSession(), null);
  write.mockImplementation(realWrite);
  assert.equal(await restoreSession(), null);
});

test('세션 교체는 세대를 올리고, 복구는 올리지 않는다', async () => {
  const before = sessionGeneration();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  assert.equal(sessionGeneration(), before + 1);

  await restoreSession();
  assert.equal(sessionGeneration(), before + 1);

  await clearSession();
  assert.equal(sessionGeneration(), before + 2);
});
