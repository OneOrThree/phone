import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  clearLocalDataOwner,
  clearRejectedSession,
  clearSession,
  getLastSessionUserId,
  getSession,
  LogoutNotDurableError,
  rememberLocalDataOwner,
  restoreSession,
  saveRefreshedSession,
  saveSession,
  sessionGeneration,
  subscribeSession,
} from '@/services/api/session';

const write = SecureStore.setItemAsync as jest.Mock;
const writeAsync = AsyncStorage.setItem as jest.Mock;
const remove = SecureStore.deleteItemAsync as jest.Mock;
const read = SecureStore.getItemAsync as jest.Mock;
// jest.setup.js 의 메모리 저장소 구현. 찢어진 쓰기·삭제를 흉내 낸 뒤 여기로 되돌린다.
const realWrite = write.getMockImplementation() as (key: string, value: string) => Promise<void>;
const realWriteAsync = writeAsync.getMockImplementation() as (
  key: string,
  value: string,
) => Promise<void>;
const realRemove = remove.getMockImplementation() as (key: string) => Promise<void>;
const realRead = read.getMockImplementation() as (key: string) => Promise<string | null>;

beforeEach(async () => {
  write.mockImplementation(realWrite);
  writeAsync.mockImplementation(realWriteAsync);
  remove.mockImplementation(realRemove);
  read.mockImplementation(realRead);
  write.mockClear();
  read.mockClear();
  await AsyncStorage.multiRemove(['gromo:accessToken', 'gromo:refreshToken', 'gromo:user']);
  await AsyncStorage.removeItem('gromo.androidLegacyLogoutPending');
  await SecureStore.deleteItemAsync('gromo.androidLegacyLogoutPending');
  await AsyncStorage.removeItem('gromo.lastUserIdClearState');
  await SecureStore.deleteItemAsync('gromo.lastUserIdClearPending');
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

test('Android 명시 로그아웃 crash tombstone은 bundle이 먼저 지워져도 legacy RT 재복구를 막는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);
  await restoreSession();

  const removeLegacy = AsyncStorage.removeItem as jest.Mock;
  const originalRemoveLegacy = removeLegacy.getMockImplementation() as (
    key: string,
  ) => Promise<void>;
  let failRefreshRemoval = true;
  removeLegacy.mockImplementation(async (key: string) => {
    if (key === 'gromo:refreshToken' && failRefreshRemoval) {
      failRefreshRemoval = false;
      throw new Error('legacy RT 삭제 전 종료');
    }
    return originalRemoveLegacy.call(AsyncStorage, key);
  });

  try {
    await assert.rejects(clearSession(undefined, false, true), /legacy RT 삭제 전 종료/);
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), '1');

    removeLegacy.mockImplementation(originalRemoveLegacy);
    assert.equal(await restoreSession(), null);
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), null);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionPendingPromotion'), null);
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), null);
  } finally {
    removeLegacy.mockImplementation(originalRemoveLegacy);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('iOS 명시 로그아웃도 bundle 삭제가 실패하면 tombstone으로 다음 복구에서 세션을 지운다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  try {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
    remove.mockImplementation(async (key: string) => {
      if (key === 'gromo.sessionBundle') throw new Error('키체인 삭제 실패');
      return realRemove(key);
    });
    await assert.rejects(clearSession(undefined, false, true), /키체인 삭제 실패/);
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), '1');
    assert.ok(await SecureStore.getItemAsync('gromo.sessionBundle'));

    remove.mockImplementation(realRemove);
    assert.equal(await restoreSession(), null);
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), null);
  } finally {
    remove.mockImplementation(realRemove);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android logout tombstone 기록이 두 저장소에서 실패하면 bundle 삭제를 시작하지 않는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const original = { accessToken: 'AT', refreshToken: 'RT', userId: 'user-a' };
  await saveSession(original);
  writeAsync.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.androidLegacyLogoutPending') throw new Error('AsyncStorage tombstone 실패');
    return realWriteAsync(key, value);
  });
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.androidLegacyLogoutPending') throw new Error('SecureStore tombstone 실패');
    return realWrite(key, value);
  });

  try {
    await assert.rejects(
      clearSession(undefined, false, true),
      (error: unknown) =>
        error instanceof LogoutNotDurableError &&
        /AsyncStorage tombstone 실패/.test(String((error.cause as Error).message)),
    );
    assert.deepEqual(getSession(), original);
    assert.deepEqual(await restoreSession(), original);
  } finally {
    writeAsync.mockImplementation(realWriteAsync);
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

test('legacy pending 조회 실패는 원본을 보존하면서 현재 SecureStore 세션을 정리한다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);
  await restoreSession();
  const generation = sessionGeneration();
  read.mockImplementation(async (key: string) => {
    if (key === 'gromo.legacySessionPendingPromotion') throw new Error('키체인 조회 실패');
    return realRead(key);
  });

  try {
    assert.equal(await clearRejectedSession(generation), true);
    assert.equal(getSession(), null);
    assert.equal(sessionGeneration(), generation + 1);
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.accessToken'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.refreshToken'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.userId'), null);
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), accessToken);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
    assert.equal(await realRead('gromo.legacySessionPendingPromotion'), '1');
  } finally {
    read.mockImplementation(realRead);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('pending 조회 도중 새 로그인이 끝나면 기존 generation fence가 새 세션 정리를 막는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'old-user' });
  const generation = sessionGeneration();
  let releaseLookup!: (value: string | null) => void;
  let markLookupStarted!: () => void;
  const lookupStarted = new Promise<void>((resolve) => {
    markLookupStarted = resolve;
  });
  const delayedLookup = new Promise<string | null>((resolve) => {
    releaseLookup = resolve;
  });
  read.mockImplementation(async (key: string) => {
    if (key === 'gromo.legacySessionPendingPromotion') {
      markLookupStarted();
      return delayedLookup;
    }
    return realRead(key);
  });

  try {
    const clearing = clearRejectedSession(generation);
    await lookupStarted;
    await saveSession({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', userId: 'new-user' });
    releaseLookup('1');

    assert.equal(await clearing, false);
    assert.deepEqual(getSession(), {
      accessToken: 'NEW_AT',
      refreshToken: 'NEW_RT',
      userId: 'new-user',
    });
    assert.deepEqual(await restoreSession(), {
      accessToken: 'NEW_AT',
      refreshToken: 'NEW_RT',
      userId: 'new-user',
    });
  } finally {
    read.mockImplementation(realRead);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android 명시 로그아웃이 원본 RT 삭제 전에 중단되면 다음 부팅이 로그아웃을 마저 끝낸다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);
  const removeAsync = AsyncStorage.removeItem as jest.Mock;
  const realRemoveAsync = removeAsync.getMockImplementation() as (key: string) => Promise<void>;

  try {
    assert.ok(await restoreSession());
    removeAsync.mockImplementation(async (key: string) => {
      if (key === 'gromo:refreshToken') throw new Error('원본 RT 삭제 전 종료');
      await realRemoveAsync(key);
    });
    await assert.rejects(clearSession(undefined, false, true));
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), 'legacy-refresh');
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), '1');
    removeAsync.mockImplementation(realRemoveAsync);

    assert.equal(await restoreSession(), null);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), null);
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), null);
  } finally {
    removeAsync.mockImplementation(realRemoveAsync);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('Android 로그아웃 tombstone이 남은 뒤 새로 로그인하면 다음 부팅에서 새 세션을 지우지 않는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await AsyncStorage.setItem('gromo.androidLegacyLogoutPending', '1');
  await AsyncStorage.setItem('gromo:refreshToken', 'legacy-refresh');

  try {
    await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
    assert.equal(await AsyncStorage.getItem('gromo.androidLegacyLogoutPending'), null);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), null);
    assert.deepEqual(await restoreSession(), {
      accessToken: 'B_AT',
      refreshToken: 'B_RT',
      userId: 'user-b',
    });
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('레거시 복사본 뒤 새 계정으로 로그인하면 보존 표식과 원본을 폐기해 재복사하지 않는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const accessToken = `header.${btoa(JSON.stringify({ sub: 'legacy-user' }))}.signature`;
  await AsyncStorage.multiSet([
    ['gromo:accessToken', accessToken],
    ['gromo:refreshToken', 'legacy-refresh'],
  ]);

  try {
    assert.equal((await restoreSession())?.userId, 'legacy-user');
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionPendingPromotion'), '1');

    await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionPendingPromotion'), null);
    assert.equal(await SecureStore.getItemAsync('gromo.legacySessionMigrated'), '1');
    assert.equal(await AsyncStorage.getItem('gromo:accessToken'), null);
    assert.equal(await AsyncStorage.getItem('gromo:refreshToken'), null);

    assert.equal(await clearRejectedSession(sessionGeneration()), true);
    assert.equal(await restoreSession(), null);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('레거시 재복사 차단 표식을 못 쓰면 새 세션을 커밋하지 않는다', async () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.legacySessionMigrated') throw new Error('차단 표식 쓰기 실패');
    await realWrite(key, value);
  });

  try {
    await assert.rejects(
      saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' }),
      /차단 표식 쓰기 실패/,
    );
    assert.equal(getSession(), null);
    assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
  } finally {
    write.mockImplementation(realWrite);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  }
});

test('legacy pending 표식이 없는 현재 세션은 401 정리에서 정상 제거된다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  const generation = sessionGeneration();

  assert.equal(await clearRejectedSession(generation), true);
  assert.equal(getSession(), null);
  assert.equal(sessionGeneration(), generation + 1);
  assert.equal(await SecureStore.getItemAsync('gromo.sessionBundle'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.accessToken'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.refreshToken'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.userId'), null);
});

test('저장한 세션은 그대로 복구된다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  assert.deepEqual(await restoreSession(), { accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('이전 fixed-key marker 세션은 복구되고 첫 갱신부터 슬롯 포맷으로 전환된다', async () => {
  await realWrite('gromo.accessToken', 'old-bundle.OLD_AT');
  await realWrite('gromo.refreshToken', 'old-bundle.OLD_RT');
  await realWrite('gromo.userId', 'old-bundle.user');
  await realWrite('gromo.sessionBundle', 'old-bundle');

  assert.deepEqual(await restoreSession(), {
    accessToken: 'OLD_AT',
    refreshToken: 'OLD_RT',
    userId: 'user',
  });
  const generation = sessionGeneration();
  assert.deepEqual(await saveRefreshedSession('NEW_AT', 'NEW_RT', generation, 'OLD_AT', 'OLD_RT'), {
    accessToken: 'NEW_AT',
    refreshToken: 'NEW_RT',
    userId: 'user',
  });
  assert.match((await realRead('gromo.sessionBundle')) ?? '', /^slotA:/);
  assert.deepEqual(await restoreSession(), {
    accessToken: 'NEW_AT',
    refreshToken: 'NEW_RT',
    userId: 'user',
  });
});

test('refresh bundle 저장은 토큰을 marker-last로 함께 바꾸고 generation을 유지한다', async () => {
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'RT', userId: 'u1' });
  const generation = sessionGeneration();
  write.mockClear();

  assert.deepEqual(await saveRefreshedSession('NEW_AT', null, generation, 'OLD_AT', 'RT'), {
    accessToken: 'NEW_AT',
    refreshToken: 'RT',
    userId: 'u1',
  });
  assert.equal(sessionGeneration(), generation);
  assert.deepEqual(await restoreSession(), {
    accessToken: 'NEW_AT',
    refreshToken: 'RT',
    userId: 'u1',
  });
  assert.equal(write.mock.calls[write.mock.calls.length - 1][0], 'gromo.sessionBundle');
});

test('refresh 중 새 슬롯 쓰기가 실패해도 재시작에서 이전 유효 RT를 복구한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  const generation = sessionGeneration();
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.sessionSlot.B.refreshToken') throw new Error('중간 슬롯 쓰기 실패');
    await realWrite(key, value);
  });

  try {
    await assert.rejects(
      saveRefreshedSession('ROTATED_AT', 'ROTATED_RT', generation, 'GUEST_AT', 'GUEST_RT'),
      /중간 슬롯 쓰기 실패/,
    );
    assert.deepEqual(getSession(), {
      accessToken: 'GUEST_AT',
      refreshToken: 'GUEST_RT',
      userId: 'guest',
    });
    write.mockImplementation(realWrite);
    assert.deepEqual(await restoreSession(), {
      accessToken: 'GUEST_AT',
      refreshToken: 'GUEST_RT',
      userId: 'guest',
    });
  } finally {
    write.mockImplementation(realWrite);
  }
});

test('refresh 포인터 marker 쓰기가 실패하면 이전 슬롯과 RT를 유지한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  const generation = sessionGeneration();
  const activeMarker = await realRead('gromo.sessionBundle');
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.sessionBundle') throw new Error('marker 쓰기 실패');
    await realWrite(key, value);
  });

  try {
    await assert.rejects(
      saveRefreshedSession('ROTATED_AT', 'ROTATED_RT', generation, 'GUEST_AT', 'GUEST_RT'),
      /marker 쓰기 실패/,
    );
    write.mockImplementation(realWrite);
    assert.equal(await realRead('gromo.sessionBundle'), activeMarker);
    assert.deepEqual(await restoreSession(), {
      accessToken: 'GUEST_AT',
      refreshToken: 'GUEST_RT',
      userId: 'guest',
    });
  } finally {
    write.mockImplementation(realWrite);
  }
});

test('refresh bundle은 세대나 저장 RT가 달라진 응답을 버린다', async () => {
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'u1' });
  const generation = sessionGeneration();
  await saveSession({ accessToken: 'NEW_ACCOUNT_AT', refreshToken: 'NEW_RT', userId: 'u2' });

  assert.equal(
    await saveRefreshedSession('STALE_AT', 'ROTATED_RT', generation, 'OLD_AT', 'OLD_RT'),
    null,
  );
  assert.deepEqual(getSession(), {
    accessToken: 'NEW_ACCOUNT_AT',
    refreshToken: 'NEW_RT',
    userId: 'u2',
  });
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

test('탈퇴 성공 경로는 일반 로그아웃이 보존한 마지막 사용자 소유자 표식을 제거한다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  await clearSession();

  assert.equal(getLastSessionUserId(), 'withdrawn-user');
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'withdrawn-user');

  await clearLocalDataOwner();

  assert.equal(getLastSessionUserId(), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  await restoreSession();
  assert.equal(getLastSessionUserId(), null);
});

test('탈퇴 후 SecureStore owner 삭제 실패는 durable tombstone을 남기고 복구 시 재시도한다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  remove.mockImplementation(async (key: string) => {
    if (key === 'gromo.lastUserId') throw new Error('키체인 삭제 실패');
    return realRemove(key);
  });

  await assert.rejects(clearLocalDataOwner(), /키체인 삭제 실패/);
  assert.equal(getLastSessionUserId(), null);
  assert.equal(await AsyncStorage.getItem('gromo.lastUserIdClearState'), 'pending');
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'withdrawn-user');

  remove.mockImplementation(realRemove);
  await restoreSession();
  assert.equal(getLastSessionUserId(), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  assert.equal(await AsyncStorage.getItem('gromo.lastUserIdClearState'), 'cleared');
});

test('탈퇴 삭제 의도 기록이 실패해도 보조 표식으로 다음 복구에서 소유자를 지운다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  writeAsync.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.lastUserIdClearState') throw new Error('AsyncStorage 쓰기 실패');
    return realWriteAsync(key, value);
  });
  remove.mockImplementation(async (key: string) => {
    if (key === 'gromo.lastUserId') throw new Error('키체인 삭제 실패');
    return realRemove(key);
  });

  await assert.rejects(clearLocalDataOwner());
  assert.equal(getLastSessionUserId(), null);
  assert.equal(await AsyncStorage.getItem('gromo.lastUserIdClearState'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserIdClearPending'), 'pending');
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'withdrawn-user');

  writeAsync.mockImplementation(realWriteAsync);
  remove.mockImplementation(realRemove);
  await restoreSession();
  assert.equal(getLastSessionUserId(), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  assert.equal(await AsyncStorage.getItem('gromo.lastUserIdClearState'), 'cleared');
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserIdClearPending'), null);

  await rememberLocalDataOwner('withdrawn-user');
  assert.equal(await AsyncStorage.getItem('gromo.lastUserIdClearState'), null);
  await restoreSession();
  assert.equal(getLastSessionUserId(), 'withdrawn-user');
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

test('세션 세대가 바뀐 뒤에는 같은 사용자 ID여도 stale 소유자 기록을 거부한다', async () => {
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await restoreSession();
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'same-user' });
  const expectedGeneration = sessionGeneration();

  await saveSession({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', userId: 'same-user' });
  assert.equal(await rememberLocalDataOwner('same-user', expectedGeneration), false);
  assert.equal(getLastSessionUserId(), 'same-user');
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
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
    new Set([
      'gromo.sessionBundle',
      'gromo.accessToken',
      'gromo.refreshToken',
      'gromo.userId',
      'gromo.sessionSlot.A.accessToken',
      'gromo.sessionSlot.A.refreshToken',
      'gromo.sessionSlot.A.userId',
      'gromo.sessionSlot.B.accessToken',
      'gromo.sessionSlot.B.refreshToken',
      'gromo.sessionSlot.B.userId',
    ]),
  );
  stopBroken();
  stopHealthy();
});

test('커밋 마커를 마지막에 쓴다 — 중간에 죽으면 복구를 거부한다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  const keys = write.mock.calls.map((c) => c[0]).filter((key) => key !== 'gromo.lastUserId');
  assert.equal(keys[keys.length - 1], 'gromo.sessionBundle');
});

test('비활성 슬롯 AT 만 쓰이고 RT 전에 죽으면 이전 세션과 RT를 복구한다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });

  // 다음 슬롯에 AT만 새로 쓰고 그 뒤 작업은 실패한다. 포인터는 이전 슬롯을 계속 가리킨다.
  write.mockImplementation(async (key: string, value: string) => {
    if (key !== 'gromo.sessionSlot.B.accessToken') throw new Error('프로세스 종료');
    return realWrite(key, value);
  });
  await assert.rejects(saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'u1' }));

  assert.deepEqual(await restoreSession(), {
    accessToken: 'AT1',
    refreshToken: 'RT1',
    userId: 'u1',
  });
});

test('커밋이 끝난 뒤에야 새 세션을 공개한다 — 부분 실패면 이전 세션 그대로다', async () => {
  await saveSession({ accessToken: 'AT1', refreshToken: 'RT1', userId: 'u1' });
  const before = sessionGeneration();

  // 비활성 슬롯 RT 쓰기만 실패한다.
  let failOnce = true;
  write.mockImplementation(async (key: string, value: string) => {
    if (key === 'gromo.sessionSlot.B.refreshToken' && failOnce) {
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
    if (key === 'gromo.sessionSlot.B.accessToken') throw new Error('키체인 쓰기 실패');
    if (key === 'gromo.sessionSlot.B.refreshToken') {
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
