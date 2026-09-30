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
