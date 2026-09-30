import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearLegacyUserData,
  legacyCustomCharacterFileName,
  type LegacyDocumentFiles,
} from '@/services/legacyUserData';

const fakeFiles = (fail?: string) => {
  const removed: string[] = [];
  const files: LegacyDocumentFiles = {
    remove(name) {
      if (name === fail) throw new Error('file delete failed');
      removed.push(name);
    },
  };
  return { files, removed };
};

const readJson = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('누끼 파일명은 1.x 네이티브와 같이 userId 의 영숫자·-·_ 만 남긴다', () => {
  assert.equal(legacyCustomCharacterFileName('a1b2-c3_d4'), 'customCharacter_a1b2-c3_d4.png');
  assert.equal(legacyCustomCharacterFileName('u.s@r'), 'customCharacter_usr.png');
  assert.equal(legacyCustomCharacterFileName('@@'), 'customCharacter.png');
});

test('탈퇴 계정의 1.x 버킷·마커·누끼 파일만 지우고 다른 계정 데이터는 보존한다', async () => {
  await AsyncStorage.multiSet([
    ['gromo:equipment:v2', JSON.stringify({ 'user-a': { equippedItem: 'x' }, 'user-b': {} })],
    ['gromo:ownedItems:v2', JSON.stringify({ 'user-a': ['i1'], 'user-b': ['i2'] })],
    [
      'gromo:character:v1',
      JSON.stringify({
        'user-a': {
          choice: 'custom',
          customUri:
            'file:///data/user/0/com.oneorthree.gromo/files/customCharacter_user-a.png?t=1',
          createdAt: 1,
        },
      }),
    ],
    ['gromo:groups:cardOrder:v1', JSON.stringify({ 'user-a': ['g1'] })],
    ['gromo:groups:cardEmoji:v1', JSON.stringify({ 'user-b': { g2: '🐟' } })],
    ['gromo:ownedItems', JSON.stringify(['i1'])],
    ['gromo:equipment', JSON.stringify({ equippedItem: 'x' })],
    ['gromo:ownedItems:legacyOwner', 'user-a'],
    ['gromo:sessionResult:user-a:s1', '2026-09-01'],
    ['gromo:sessionResult:user-b:s2', '2026-09-01'],
    ['gromo:groupChallengeSettlement:user-a:s1', '1'],
    ['gromo:screentime:syncState', JSON.stringify({ userId: 'user-a', minutes: 3 })],
    ['gromo:screentime:lastClosedDate', JSON.stringify({ userId: 'user-b', date: 'd' })],
    ['gromo:focus:streakPoppedDate', JSON.stringify(['user-a:2026-09-01', 'user-b:2026-09-01'])],
    ['gromo:settings:locale', 'ko'],
  ]);
  const { files, removed } = fakeFiles();

  await clearLegacyUserData('user-a', files);

  assert.deepEqual(await readJson('gromo:equipment:v2'), { 'user-b': {} });
  assert.deepEqual(await readJson('gromo:ownedItems:v2'), { 'user-b': ['i2'] });
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), null);
  assert.equal(await AsyncStorage.getItem('gromo:groups:cardOrder:v1'), null);
  assert.deepEqual(await readJson('gromo:groups:cardEmoji:v1'), { 'user-b': { g2: '🐟' } });
  assert.equal(await AsyncStorage.getItem('gromo:ownedItems'), null);
  assert.equal(await AsyncStorage.getItem('gromo:equipment'), null);
  assert.equal(await AsyncStorage.getItem('gromo:ownedItems:legacyOwner'), null);
  assert.equal(await AsyncStorage.getItem('gromo:sessionResult:user-a:s1'), null);
  assert.equal(await AsyncStorage.getItem('gromo:sessionResult:user-b:s2'), '2026-09-01');
  assert.equal(await AsyncStorage.getItem('gromo:groupChallengeSettlement:user-a:s1'), null);
  assert.equal(await AsyncStorage.getItem('gromo:screentime:syncState'), null);
  assert.notEqual(await AsyncStorage.getItem('gromo:screentime:lastClosedDate'), null);
  assert.deepEqual(await readJson('gromo:focus:streakPoppedDate'), ['user-b:2026-09-01']);
  // 기기 귀속 설정은 건드리지 않는다.
  assert.equal(await AsyncStorage.getItem('gromo:settings:locale'), 'ko');
  assert.deepEqual(removed.sort(), [
    'customCharacter_user-a.png',
    'customCharacter_user-a.png.tmp',
  ]);
});

test('듀얼라이트 소유자가 다른 계정이면 롤백 호환 키를 남긴다', async () => {
  await AsyncStorage.multiSet([
    ['gromo:ownedItems', JSON.stringify(['i2'])],
    ['gromo:equipment', JSON.stringify({})],
    ['gromo:ownedItems:legacyOwner', 'user-b'],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.notEqual(await AsyncStorage.getItem('gromo:ownedItems'), null);
  assert.notEqual(await AsyncStorage.getItem('gromo:equipment'), null);
  assert.equal(await AsyncStorage.getItem('gromo:ownedItems:legacyOwner'), 'user-b');
});

test('공용 폴백 누끼 파일은 다른 계정이 참조하지 않을 때만 지운다', async () => {
  const fallback = 'file:///data/user/0/com.oneorthree.gromo/files/customCharacter.png?t=9';
  await AsyncStorage.setItem(
    'gromo:character:v1',
    JSON.stringify({
      'user-a': { choice: 'custom', customUri: fallback, createdAt: 1 },
      'user-b': { choice: 'custom', customUri: fallback, createdAt: 2 },
    }),
  );
  const shared = fakeFiles();
  await clearLegacyUserData('user-a', shared.files);
  assert.ok(!shared.removed.includes('customCharacter.png'));

  const alone = fakeFiles();
  await clearLegacyUserData('user-b', alone.files);
  assert.ok(alone.removed.includes('customCharacter.png'));
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), null);
});

test('손상된 계정별 맵은 선택 삭제가 불가능하므로 키째 지운다', async () => {
  await AsyncStorage.setItem('gromo:ownedItems:v2', '{not json');
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:ownedItems:v2'), null);
});

test('파일 삭제가 실패하면 던지고 키를 지우지 않아 재시도가 같은 파일을 다시 찾는다', async () => {
  const fallback = 'file:///data/user/0/com.oneorthree.gromo/files/customCharacter.png';
  const bucket = JSON.stringify({ 'user-a': { choice: 'custom', customUri: fallback } });
  await AsyncStorage.setItem('gromo:character:v1', bucket);

  await assert.rejects(clearLegacyUserData('user-a', fakeFiles('customCharacter.png').files));
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), bucket);

  const retry = fakeFiles();
  await clearLegacyUserData('user-a', retry.files);
  assert.ok(retry.removed.includes('customCharacter.png'));
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), null);
});

test('저장소 삭제가 실패하면 던진다', async () => {
  await AsyncStorage.setItem('gromo:groups:cardOrder:v1', JSON.stringify({ 'user-a': ['g1'] }));
  // jest.setup 의 AsyncStorage 는 이미 jest.fn 이다 — 구현을 지우지 않게 한 번만 실패시킨다.
  (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await assert.rejects(clearLegacyUserData('user-a', fakeFiles().files));
});

test('1.x 데이터가 없는 기기에서도 없는 파일 삭제만 시도하고 성공한다', async () => {
  const { files, removed } = fakeFiles();
  await clearLegacyUserData('user-a', files);
  assert.deepEqual(removed.sort(), [
    'customCharacter_user-a.png',
    'customCharacter_user-a.png.tmp',
  ]);
});

test('계정 귀속 대기열·라이브 세션은 탈퇴 계정 항목만 지운다', async () => {
  await AsyncStorage.multiSet([
    [
      'gromo:focus:pendingUploads',
      JSON.stringify([
        { userId: 'user-a', body: { s: 1 } },
        { userId: 'user-b', body: { s: 2 } },
      ]),
    ],
    ['gromo:focus:pendingCancels', JSON.stringify([{ userId: 'user-a', sessionId: 'm1' }])],
    ['gromo:focus:liveSession', JSON.stringify({ userId: 'user-a', elapsed: 30 })],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.deepEqual(await readJson('gromo:focus:pendingUploads'), [
    { userId: 'user-b', body: { s: 2 } },
  ]);
  assert.equal(await AsyncStorage.getItem('gromo:focus:pendingCancels'), null);
  assert.equal(await AsyncStorage.getItem('gromo:focus:liveSession'), null);
});

test('다른 계정의 라이브 세션과 손상된 대기열 — 전자는 남기고 후자는 키째 지운다', async () => {
  const live = JSON.stringify({ userId: 'user-b', elapsed: 30 });
  await AsyncStorage.multiSet([
    ['gromo:focus:liveSession', live],
    ['gromo:focus:pendingUploads', '{not json'],
    ['gromo:focus:pendingCancels', JSON.stringify([{ userId: 'user-b', sessionId: 'm2' }])],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:focus:liveSession'), live);
  assert.equal(await AsyncStorage.getItem('gromo:focus:pendingUploads'), null);
  assert.deepEqual(await readJson('gromo:focus:pendingCancels'), [
    { userId: 'user-b', sessionId: 'm2' },
  ]);
});

test('마지막 provider·알림 보관함은 마지막 활성 1.x 계정이 탈퇴 계정일 때만 지운다', async () => {
  const inbox = JSON.stringify([{ id: 'n1', title: 't', body: 'b', read: false }]);
  await AsyncStorage.multiSet([
    ['gromo:auth:lastProvider', 'kakao'],
    ['gromo:notifications', inbox],
    ['gromo:ownedItems:legacyOwner', 'user-b'],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:auth:lastProvider'), 'kakao');
  assert.equal(await AsyncStorage.getItem('gromo:notifications'), inbox);

  await AsyncStorage.removeItem('gromo:ownedItems:legacyOwner');
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:auth:lastProvider'), 'kakao');

  await AsyncStorage.setItem('gromo:ownedItems:legacyOwner', 'user-a');
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:auth:lastProvider'), null);
  assert.equal(await AsyncStorage.getItem('gromo:notifications'), null);
});

// 서명 없는 테스트용 JWT — 소유자 판정은 페이로드 sub 만 본다.
const jwt = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString('base64').replace(/=+$/, '')}.s`;

const SINGLE_USER_VALUES: [string, string][] = [
  ['gromo:onboardingComplete', 'true'],
  ['gromo:focusCategory', '공무원'],
  ['gromo:subjects', JSON.stringify([{ id: 's1', name: '영어' }])],
  ['gromo:focus', JSON.stringify({ todaySeconds: 60 })],
  ['gromo:focus:firstDone', '1'],
  ['gromo:settings:notification', JSON.stringify({ push: true })],
  ['gromo:auth:lastProvider', 'kakao'],
];

test('1.x 로그인 프로필의 토큰 sub 가 탈퇴 계정이면 단일 값 계정 데이터를 지운다', async () => {
  await AsyncStorage.multiSet([
    ...SINGLE_USER_VALUES,
    ['gromo:user', JSON.stringify({ userId: 'stale-1', accessToken: jwt('user-a') })],
    // 마지막 듀얼라이트 소유자가 달라도 로그인 프로필이 정본이다.
    ['gromo:ownedItems:legacyOwner', 'user-b'],
    ['gromo:deviceId', 'device-1'],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:user'), null);
  for (const [key] of SINGLE_USER_VALUES) assert.equal(await AsyncStorage.getItem(key), null, key);
  // 기기 귀속 값·다른 계정 소유 표식은 남긴다.
  assert.equal(await AsyncStorage.getItem('gromo:deviceId'), 'device-1');
  assert.equal(await AsyncStorage.getItem('gromo:ownedItems:legacyOwner'), 'user-b');
});

test('토큰이 없는 1.x 프로필은 저장된 userId 로 소유자를 판정한다', async () => {
  await AsyncStorage.multiSet([
    ['gromo:user', JSON.stringify({ userId: 'user-a' })],
    ['gromo:subjects', '[]'],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:user'), null);
  assert.equal(await AsyncStorage.getItem('gromo:subjects'), null);
});

test('1.x 로그인 프로필이 다른 계정이면 단일 값은 건드리지 않는다', async () => {
  const profile = JSON.stringify({ accessToken: jwt('user-b') });
  await AsyncStorage.multiSet([...SINGLE_USER_VALUES, ['gromo:user', profile]]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:user'), profile);
  for (const [key, value] of SINGLE_USER_VALUES)
    assert.equal(await AsyncStorage.getItem(key), value, key);
});

test('1.x 프로필 소유자를 알 수 없으면 legacyOwner 로 대신하지 않고 남긴다', async () => {
  await AsyncStorage.multiSet([
    ...SINGLE_USER_VALUES,
    ['gromo:user', '{not json'],
    ['gromo:ownedItems:legacyOwner', 'user-a'],
  ]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:user'), '{not json');
  for (const [key, value] of SINGLE_USER_VALUES)
    assert.equal(await AsyncStorage.getItem(key), value, key);

  await AsyncStorage.setItem('gromo:user', JSON.stringify({ nickname: 'x', accessToken: 'bad' }));
  await clearLegacyUserData('user-a', fakeFiles().files);
  assert.equal(await AsyncStorage.getItem('gromo:subjects'), SINGLE_USER_VALUES[2][1]);
});

test('1.x 가 로그아웃 상태면 마지막 활성 계정(legacyOwner)으로 단일 값 소유자를 판정한다', async () => {
  await AsyncStorage.multiSet([...SINGLE_USER_VALUES, ['gromo:ownedItems:legacyOwner', 'user-a']]);
  await clearLegacyUserData('user-a', fakeFiles().files);
  for (const [key] of SINGLE_USER_VALUES) assert.equal(await AsyncStorage.getItem(key), null, key);
});
