import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createIslandDraftKey,
  emptyCreateIslandDraft,
  readCreateIslandDraft,
  removeCreateIslandDraft,
  writeCreateIslandDraft,
} from './createIslandDraft';

beforeEach(async () => {
  await AsyncStorage.clear();
});
test('queued edits restore latest values and stay isolated by account', async () => {
  const first = writeCreateIslandDraft('a', { ...emptyCreateIslandDraft, name: '첫 초안' });
  const last = writeCreateIslandDraft('a', {
    name: '최종 초안',
    intro: '소개',
    capacity: 3,
    approval: true,
  });
  expect(await readCreateIslandDraft('a')).toEqual({
    name: '최종 초안',
    intro: '소개',
    capacity: 3,
    approval: true,
  });
  expect(await readCreateIslandDraft('b')).toBeNull();
  await Promise.all([first, last]);
});
test('successful creation cleanup follows pending writes', async () => {
  const write = writeCreateIslandDraft('a', { ...emptyCreateIslandDraft, name: '초안' });
  await removeCreateIslandDraft('a');
  await write;
  expect(await readCreateIslandDraft('a')).toBeNull();
});
test('invalid storage is ignored and restored fields obey server limits', async () => {
  await AsyncStorage.setItem(createIslandDraftKey('a'), '{');
  expect(await readCreateIslandDraft('a')).toBeNull();
  await AsyncStorage.setItem(
    createIslandDraftKey('a'),
    JSON.stringify({
      name: '가'.repeat(80),
      intro: '나'.repeat(250),
      capacity: 999,
      approval: 'true',
    }),
  );
  expect(await readCreateIslandDraft('a')).toEqual({
    name: '가'.repeat(50),
    intro: '나'.repeat(200),
    capacity: 15,
    approval: false,
  });
});
